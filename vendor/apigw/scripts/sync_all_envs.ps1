param(
  [string]$Repo = (Get-Location).Path,
  [string]$Service,
  [string]$Hu,
  [string]$User,
  [string]$Ref = "HEAD",
  [string]$OutDir,
  [string]$ConfigRepo,
  [string]$Profile,
  [string]$Region,
  [string[]]$Envs = @("dev", "ci", "prod"),
  [switch]$SkipPr,
  [switch]$SkipValidate
)

$ErrorActionPreference = "Stop"

$SkillRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $SkillRoot "scripts\skill_config.ps1")

$ConfigRepo = Resolve-ConfigRepo -ParamValue $ConfigRepo -SkillRoot $SkillRoot
if (-not $Profile) { $Profile = Resolve-Profile -ParamValue $Profile -SkillRoot $SkillRoot }
if (-not $Region) { $Region = Resolve-Region -ParamValue $Region -SkillRoot $SkillRoot }

function Assert-NativeSuccess($Step) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE"
  }
}

function Get-HuFromBranch($Branch) {
  $patterns = @(
    "(?i)(HU[-_/]?\d+)",
    "(?i)(G66[-_/]?\d+)",
    "(?i)(APIGW[-_/]?\d+)",
    "(?i)([A-Z]+-\d+)"
  )
  foreach ($pattern in $patterns) {
    $match = [regex]::Match($Branch, $pattern)
    if ($match.Success) {
      return $match.Groups[1].Value.Replace("_", "-").Replace("/", "-")
    }
  }
  return $null
}

function Get-BranchUser($Branch) {
  $firstSegment = ($Branch -split "/")[0]
  if ($firstSegment -and $firstSegment -notin @("dev", "ci", "prod", "development", "master", "release", "feature", "fix", "hotfix", "bugfix")) {
    return $firstSegment
  }
  return $env:USERNAME
}

function Get-BaseBranchForEnv($Env) {
  switch ($Env) {
    "dev" { return "development" }
    "ci" { return "master" }
    "prod" { return "release" }
    default { throw "Unsupported environment '$Env'. Use dev, ci, or prod." }
  }
}

function Get-CodeCommitPr($RepoName, $SourceBranch, $Region) {
  $awsCommon = @("--region", $Region)
  if ($Profile) { $awsCommon += @("--profile", $Profile) }

  $list = aws codecommit list-pull-requests `
    --repository-name $RepoName `
    --pull-request-status OPEN `
    @awsCommon | ConvertFrom-Json
  Assert-NativeSuccess "aws codecommit list-pull-requests"

  foreach ($id in $list.pullRequestIds) {
    $pr = aws codecommit get-pull-request --pull-request-id $id @awsCommon | ConvertFrom-Json
    Assert-NativeSuccess "aws codecommit get-pull-request $id"
    foreach ($target in $pr.pullRequest.pullRequestTargets) {
      if ($target.sourceReference -eq $SourceBranch -or $target.sourceReference -eq "refs/heads/$SourceBranch") {
        return $id
      }
    }
  }
  return $null
}

function Upsert-CodeCommitPr($RepoName, $SourceBranch, $TargetBranch, $Title, $Description, $Region) {
  $awsCommon = @("--region", $Region)
  if ($Profile) { $awsCommon += @("--profile", $Profile) }

  $existingId = Get-CodeCommitPr $RepoName $SourceBranch $Region
  if ($existingId) {
    aws codecommit update-pull-request-title `
      --pull-request-id $existingId `
      --title $Title `
      @awsCommon | Out-Null
    Assert-NativeSuccess "aws codecommit update-pull-request-title"

    aws codecommit update-pull-request-description `
      --pull-request-id $existingId `
      --description $Description `
      @awsCommon | Out-Null
    Assert-NativeSuccess "aws codecommit update-pull-request-description"

    return @{
      action = "updated"
      pullRequestId = $existingId
    }
  }

  $targetSpec = "repositoryName=$RepoName,sourceReference=$SourceBranch,destinationReference=$TargetBranch"
  $created = aws codecommit create-pull-request `
    --title $Title `
    --description $Description `
    --targets $targetSpec `
    @awsCommon | ConvertFrom-Json
  Assert-NativeSuccess "aws codecommit create-pull-request"

  return @{
    action = "created"
    pullRequestId = $created.pullRequest.pullRequestId
  }
}

$Repo = (Resolve-Path -LiteralPath $Repo).Path
if (-not (Test-Path -LiteralPath $ConfigRepo)) {
  throw "ConfigRepo path does not exist: '$ConfigRepo'. Set it via -ConfigRepo, env var APIGW_APIDOC_CONFIG_REPO, or apigw-apidoc.config.json."
}
$ConfigRepo = (Resolve-Path -LiteralPath $ConfigRepo).Path
$safeRepo = $Repo.Replace("\", "/")
$branch = (& git -c "safe.directory=$safeRepo" -C $Repo branch --show-current).Trim()

if (-not $Service) {
  $repoName = Split-Path -Leaf $Repo
  $Service = if ($repoName.StartsWith("ms-")) { $repoName.Substring(3) } else { $repoName }
}

if (-not $Hu) {
  $Hu = Get-HuFromBranch $branch
}
if (-not $Hu) {
  if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
    $Hu = Read-Host "Cannot infer HU from branch '$branch'. Enter HU"
  }
  if (-not $Hu) {
    throw "Cannot infer HU from branch '$branch'. Pass -Hu."
  }
}

if (-not $User) {
  $User = Get-BranchUser $branch
}

if (-not $OutDir) {
  $OutDir = Join-Path $env:TEMP "apigw-sync\$Service"
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

if (-not $Region) {
  if ($Profile) {
    $Region = (aws configure get region --profile $Profile).Trim()
  } else {
    $Region = (aws configure get region).Trim()
  }
  if (-not $Region) { $Region = "us-east-1" }
}

$safeConfigRepo = $ConfigRepo.Replace("\", "/")
$configStatus = (& git -c "safe.directory=$safeConfigRepo" -C $ConfigRepo status --porcelain)
if ($configStatus) {
  Write-Host $configStatus
  throw "Config repository has uncommitted changes. Commit, stash, or clean them before running the all-env sync."
}

$results = @()

foreach ($env in $Envs) {
  $envOutDir = Join-Path $OutDir $env
  $baseBranch = Get-BaseBranchForEnv $env
  $sourceBranch = "$User/$env/$Hu"

  Write-Host "=== $env => $sourceBranch -> $baseBranch ==="

  $envRef = $Ref
  if (-not $envRef -or $envRef -eq "HEAD") {
    $mergeBase = (git -C $Repo merge-base HEAD "origin/$baseBranch" 2>$null).Trim()
    if ($mergeBase) { $envRef = $mergeBase } else { $envRef = "HEAD^" }
  }

  $syncArgs = @{
    Repo = $Repo
    Service = $Service
    Env = $env
    Hu = $Hu
    User = $User
    Ref = $envRef
    OutDir = $envOutDir
    ConfigRepo = $ConfigRepo
    PrepareConfig = $true
  }
  if ($Profile) { $syncArgs.Profile = $Profile }
  if ($Region) { $syncArgs.Region = $Region }
  if ($SkipValidate) { $syncArgs.SkipValidate = $true }

  & (Join-Path $SkillRoot "scripts\sync_from_aws.ps1") @syncArgs | Out-Host
  Assert-NativeSuccess "sync_from_aws.ps1 $env"

  $svcShort = if ($Service.EndsWith("-api")) { $Service.Substring(0, $Service.Length - 4) } else { $null }
  $configFile = Join-Path $ConfigRepo "$Service.yaml"
  if (-not (Test-Path $configFile) -and $svcShort) {
    $altFile = Join-Path $ConfigRepo "$svcShort.yaml"
    if (Test-Path $altFile) { $configFile = $altFile }
  }
  git -c "safe.directory=$safeConfigRepo" -C $ConfigRepo add $configFile | Out-Host
  Assert-NativeSuccess "git add $configFile"

  $title = (Get-Content -Raw (Join-Path $envOutDir "pr-title.txt")).Trim()
  $description = (Get-Content -Raw (Join-Path $envOutDir "pr-description.md")).Trim()
  $commitTitle = $title -replace "^\[$env\]\[$Hu\]\s*", ""

  $pending = (& git -c "safe.directory=$safeConfigRepo" -C $ConfigRepo diff --cached --name-only)
  if ($pending) {
    git -c "safe.directory=$safeConfigRepo" -C $ConfigRepo commit -m "[$Hu]: $commitTitle" | Out-Host
    Assert-NativeSuccess "git commit $env"
  } else {
    Write-Host "No staged changes for $env; skipping commit."
  }

  git -c "safe.directory=$safeConfigRepo" -C $ConfigRepo push -u origin $sourceBranch | Out-Host
  Assert-NativeSuccess "git push $sourceBranch"

  $prResult = $null
  $prUrl = $null
  if (-not $SkipPr) {
    $prResult = Upsert-CodeCommitPr "ms-config-api-gateway" $sourceBranch $baseBranch $title $description $Region
    $prUrl = "https://$Region.console.aws.amazon.com/codesuite/codecommit/repositories/ms-config-api-gateway/pull-requests/$($prResult.pullRequestId)/details"
  }

  $results += @{
    env = $env
    sourceBranch = $sourceBranch
    targetBranch = $baseBranch
    title = $title
    prAction = if ($prResult) { $prResult.action } else { $null }
    pullRequestId = if ($prResult) { $prResult.pullRequestId } else { $null }
    url = $prUrl
  }
}

Write-Host ""
Write-Host "════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  RESUMEN FINAL — $($Service.ToUpperInvariant())" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════" -ForegroundColor Cyan
foreach ($r in $results) {
  $status = if ($r.prAction) { "PR $($r.prAction.ToUpperInvariant()) #$($r.pullRequestId)" } else { "sin PR" }
  Write-Host "  [$($r.env.ToUpperInvariant())]  $($r.sourceBranch) -> $($r.targetBranch)  |  $status" -ForegroundColor White
  if ($r.url) { Write-Host "         $($r.url)" -ForegroundColor DarkCyan }
}
Write-Host "════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$results | ConvertTo-Json -Depth 5
