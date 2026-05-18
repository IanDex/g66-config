param(
  [string]$Repo = (Get-Location).Path,
  [string]$Service,
  [string]$Env,
  [string]$Hu,
  [string]$User,
  [string]$Ref = "HEAD",
  [string]$OutDir,
  [string]$ConfigRepo,
  [string]$Profile,
  [string]$Region,
  [switch]$PrepareConfig,
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

function Get-EnvFromBranch($Branch) {
  $branchLower = $Branch.ToLowerInvariant()
  if ($Branch -eq "development" -or $Branch -eq "dev" -or $branchLower.Contains("/dev/")) {
    return "dev"
  }
  if ($Branch -eq "master" -or $Branch -eq "ci" -or $branchLower.Contains("/ci/")) {
    return "ci"
  }
  if ($Branch -eq "release" -or $Branch -eq "prod" -or $branchLower.Contains("/prod/")) {
    return "prod"
  }
  return $null
}

function Get-BaseBranchForEnv($Env) {
  switch ($Env) {
    "dev" { return "development" }
    "ci" { return "master" }
    "prod" { return "release" }
    default { throw "Unsupported environment '$Env'. Use dev, ci, or prod." }
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

function Format-OwnerName($User) {
  return (Get-OwnerName -User $User -SkillRoot $SkillRoot)
}

function Get-PathOperations($OpenApiPath) {
  $doc = Get-Content -Raw -LiteralPath $OpenApiPath | ConvertFrom-Json
  $operations = New-Object System.Collections.Generic.List[string]
  $httpMethods = @("get", "post", "put", "delete", "patch", "options", "head", "any")
  foreach ($pathProperty in $doc.paths.PSObject.Properties) {
    foreach ($operationProperty in $pathProperty.Value.PSObject.Properties) {
      $method = $operationProperty.Name.ToLowerInvariant()
      if ($httpMethods -contains $method -and $method -ne "options") {
        $operations.Add(("{0} {1}" -f $method.ToUpperInvariant(), $pathProperty.Name))
      }
    }
  }
  return $operations.ToArray()
}

$Repo = (Resolve-Path -LiteralPath $Repo).Path
$RepoName = Split-Path -Leaf $Repo

if (-not $Service) {
  $Service = if ($RepoName.StartsWith("ms-")) { $RepoName.Substring(3) } else { $RepoName }
}

$safeRepo = $Repo.Replace("\", "/")
$Branch = (& git -c "safe.directory=$safeRepo" -C $Repo branch --show-current).Trim()

if (-not $Env) {
  $Env = Get-EnvFromBranch $Branch
  if (-not $Env) {
    Write-Error "Cannot infer environment from branch '$Branch'. Pass -Env dev|ci|prod."
  }
}

if (-not $Hu) {
  $Hu = Get-HuFromBranch $Branch
}

if (-not $User) {
  $User = Get-BranchUser $Branch
}

if (-not $OutDir) {
  $OutDir = Join-Path $env:TEMP "apigw-sync\$Service"
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Get-ChildItem -Path "$OutDir\*" -Include "*.yml","*.yaml","*.json" -File | Remove-Item -Force

$currentSwagger = Join-Path $OutDir "$Service-$Env-current.json"
$newPaths = Join-Path $OutDir "$Service-$Env-new-paths.json"
$mergedYaml = Join-Path $OutDir "$Service-$Env-merged.yaml"
$prTitleFile = Join-Path $OutDir "pr-title.txt"
$prDescriptionFile = Join-Path $OutDir "pr-description.md"

Write-Host "Service: $Service"
Write-Host "Repo: $Repo"
Write-Host "Branch: $Branch"
Write-Host "Env: $Env"
Write-Host "HU: $(if ($Hu) { $Hu } else { '<not inferred>' })"
Write-Host "OutDir: $OutDir"

$exportArgs = @{
  Service = $Service
  Env = $Env
  Out = $currentSwagger
  Format = "json"
}
if ($Profile) { $exportArgs.Profile = $Profile }
if ($Region) { $exportArgs.Region = $Region }

& (Join-Path $SkillRoot "scripts\export_apigw_swagger.ps1") @exportArgs | Out-Host
Assert-NativeSuccess "export_apigw_swagger.ps1"

$extractRaw = node (Join-Path $SkillRoot "scripts\extract_new_paths_from_diff.mjs") `
  --repo $Repo `
  --base $currentSwagger `
  --out $newPaths `
  --ref $Ref
$extractRaw | Out-Host
Assert-NativeSuccess "extract_new_paths_from_diff.mjs"
$extractResult = try { $extractRaw | ConvertFrom-Json -ErrorAction Stop } catch { $null }

node (Join-Path $SkillRoot "scripts\diff_openapi_paths.mjs") `
  --base $currentSwagger `
  --incoming $newPaths | Out-Host
Assert-NativeSuccess "diff_openapi_paths.mjs"

# Prefer existing config-repo file as merge base to preserve hand-edited content
# Fallback: strip trailing -api from service name (e.g. business-api -> business)
$existingConfigFile = $null
if ($ConfigRepo -and $Service) {
  $candidate1 = Join-Path $ConfigRepo "$Service.yaml"
  $svcShort = if ($Service.EndsWith("-api")) { $Service.Substring(0, $Service.Length - 4) } else { $null }
  $candidate2 = if ($svcShort) { Join-Path $ConfigRepo "$svcShort.yaml" } else { $null }
  if (Test-Path $candidate1) { $existingConfigFile = $candidate1 }
  elseif ($candidate2 -and (Test-Path $candidate2)) { $existingConfigFile = $candidate2 }
}
$mergeBase = if ($existingConfigFile) { $existingConfigFile } else { $currentSwagger }
Write-Host "Merge base: $mergeBase"

$mergeRaw = node (Join-Path $SkillRoot "scripts\merge_openapi_paths.mjs") `
  --base $mergeBase `
  --incoming $newPaths `
  --out $mergedYaml `
  --format yaml
$mergeRaw | Out-Host
Assert-NativeSuccess "merge_openapi_paths.mjs"
$mergeSummary = try { $mergeRaw | ConvertFrom-Json -ErrorAction Stop } catch { $null }

if (-not $SkipValidate) {
  node (Join-Path $SkillRoot "scripts\validate_openapi_apigw.mjs") $mergedYaml --incoming $newPaths | Out-Host
  Assert-NativeSuccess "validate_openapi_apigw.mjs"
} else {
  Write-Host "Skipping validate_openapi_apigw.mjs (SkipValidate flag set)"
}

$pathOperations = @(Get-PathOperations $newPaths)
$pathCount = $pathOperations.Count
$operationSummary = if ($pathCount -eq 1) { $pathOperations[0] } else { "$pathCount API Gateway paths" }
$prTitle = "[$Env][$Hu] Add $operationSummary to $Service API Gateway apidoc"
if (-not $Hu) {
  $prTitle = "[$Env] Add $operationSummary to $Service API Gateway apidoc"
}
$ownerName = Format-OwnerName $User
$jiraBase = Get-JiraBaseUrl -SkillRoot $SkillRoot
$jiraLink = if ($Hu) { "$jiraBase/$Hu" } else { "N/A" }
$apiPattern = Get-ApiNamePattern -SkillRoot $SkillRoot
$serviceCap = $Service.Substring(0,1).ToUpperInvariant() + $Service.Substring(1)
$apiName = $apiPattern.Replace("{Service}", $serviceCap).Replace("{ENV}", $Env.ToUpperInvariant())
$pathBullets = if ($pathOperations.Count -gt 0) {
  ($pathOperations | ForEach-Object { '- `{0}`' -f $_ }) -join [Environment]::NewLine
} else {
  "- No endpoint operations detected"
}

Set-Content -LiteralPath $prTitleFile -Value $prTitle -Encoding UTF8
$prDescription = @"
- **Encargado**: $ownerName
- **Link historia**: [Enlace Jira]($jiraLink)
- **Descripcion del desarrollo**:
> Updated $Service.yaml with the API Gateway apidoc generated from $apiName. The change adds the following endpoint operation(s) while preserving existing paths, integrations, authorizers, CORS/options, and security definitions:
$pathBullets
- **Dependencia de uno o varios PRs**: No
- **Requiere creacion de endpoint en API Gateway?**: Si
- **Requiere creacion de columna/as o tabla/as?**: No
- **Datos de columna/as o tabla/as**: No
- **Requiere agregar propiedades al proyecto?**: No

## Validation
- Base Swagger exported from $apiName
- Merge completed without applying potential removals
- API Gateway validation passed
- Final YAML validated successfully

## Branches
- Source: $User/$Env/$Hu
- Target: $(Get-BaseBranchForEnv $Env)
"@
$prDescription | Set-Content -LiteralPath $prDescriptionFile -Encoding UTF8

$configBaseBranch = $null
$configBranch = $null
$configFile = $null

if ($PrepareConfig) {
  if (-not $Hu) {
    if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
      $Hu = Read-Host "Cannot infer HU from branch '$Branch'. Enter HU for config branch"
    }
    if (-not $Hu) {
      Write-Error "Cannot infer HU from branch '$Branch'. Pass -Hu to prepare ms-config-api-gateway branch."
    }
  }

  $ConfigRepo = (Resolve-Path -LiteralPath $ConfigRepo).Path
  $safeConfigRepo = $ConfigRepo.Replace("\", "/")
  $configBaseBranch = Get-BaseBranchForEnv $Env
  $configBranch = "$User/$Env/$Hu"
  $svcShort = if ($Service.EndsWith("-api")) { $Service.Substring(0, $Service.Length - 4) } else { $null }
  $configFile = Join-Path $ConfigRepo "$Service.yaml"
  if (-not (Test-Path $configFile) -and $svcShort) {
    $altFile = Join-Path $ConfigRepo "$svcShort.yaml"
    if (Test-Path $altFile) { $configFile = $altFile }
  }

  Write-Host "ConfigRepo: $ConfigRepo"
  Write-Host "Config base branch: $configBaseBranch"
  Write-Host "Config work branch: $configBranch"
  Write-Host "Config file: $configFile"

  $configStatus = (& git -c "safe.directory=$safeConfigRepo" -C $ConfigRepo status --porcelain)
  if ($configStatus) {
    Write-Host $configStatus
    throw "Config repository has uncommitted changes. Commit, stash, or clean them before preparing the apidoc branch."
  }

  git -c "safe.directory=$safeConfigRepo" -C $ConfigRepo fetch origin $configBaseBranch | Out-Host
  Assert-NativeSuccess "git fetch origin $configBaseBranch"

  git -c "safe.directory=$safeConfigRepo" -C $ConfigRepo show-ref --verify --quiet "refs/heads/$configBranch"
  $branchExists = $LASTEXITCODE -eq 0
  if ($branchExists) {
    git -c "safe.directory=$safeConfigRepo" -C $ConfigRepo switch $configBranch | Out-Host
    Assert-NativeSuccess "git switch $configBranch"
    git -c "safe.directory=$safeConfigRepo" -C $ConfigRepo rebase "origin/$configBaseBranch" | Out-Host
    Assert-NativeSuccess "git rebase origin/$configBaseBranch"
  } else {
    git -c "safe.directory=$safeConfigRepo" -C $ConfigRepo switch -c $configBranch "origin/$configBaseBranch" | Out-Host
    Assert-NativeSuccess "git switch -c $configBranch origin/$configBaseBranch"
  }

  Copy-Item -LiteralPath $mergedYaml -Destination $configFile -Force

  if (-not $SkipValidate) {
    node (Join-Path $SkillRoot "scripts\validate_openapi_apigw.mjs") $configFile --incoming $newPaths | Out-Host
    Assert-NativeSuccess "validate generated config file"
  } else {
    Write-Host "Skipping config-file validation (SkipValidate flag set)"
  }

  git -c "safe.directory=$safeConfigRepo" -C $ConfigRepo status --short | Out-Host
}

Write-Host ""
Write-Host "════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  $($Service.ToUpperInvariant()) [$($Env.ToUpperInvariant())] — resumen de cambios" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════" -ForegroundColor Cyan

if ($mergeSummary) {
  $added    = @($mergeSummary.added    | Where-Object { $_ })
  $modified = @($mergeSummary.modified | Where-Object { $_ })
  $removed  = @($mergeSummary.removed  | Where-Object { $_ })

  if ($added.Count -gt 0) {
    Write-Host "  AGREGADOS ($($added.Count)):" -ForegroundColor Green
    foreach ($p in $added) { Write-Host "    + $p" -ForegroundColor Green }
  }
  if ($modified.Count -gt 0) {
    Write-Host "  MODIFICADOS ($($modified.Count)):" -ForegroundColor Yellow
    foreach ($item in $modified) {
      $ops = if ($item.operations) { $item.operations -join "," } else { "" }
      Write-Host "    ~ $($item.path)$(if ($ops) { " [$ops]" })" -ForegroundColor Yellow
    }
  }
  if ($removed.Count -gt 0) {
    Write-Host "  ELIMINADOS ($($removed.Count)):" -ForegroundColor Red
    foreach ($p in $removed) { Write-Host "    - $p" -ForegroundColor Red }
  }
  if ($added.Count -eq 0 -and $modified.Count -eq 0 -and $removed.Count -eq 0) {
    Write-Host "  Sin cambios detectados." -ForegroundColor Gray
  }
}

if ($extractResult -and $extractResult.warnings -and $extractResult.warnings.Count -gt 0) {
  Write-Host "  ADVERTENCIAS:" -ForegroundColor Yellow
  foreach ($w in $extractResult.warnings) { Write-Host "    ! $w" -ForegroundColor Yellow }
}

Write-Host "  PR: $prTitle" -ForegroundColor White
Write-Host "════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

@{
  service = $Service
  env = $Env
  branch = $Branch
  hu = $Hu
  currentSwagger = $currentSwagger
  newPaths = $newPaths
  mergedYaml = $mergedYaml
  prTitleFile = $prTitleFile
  prDescriptionFile = $prDescriptionFile
  prepareConfig = [bool]$PrepareConfig
  configRepo = if ($PrepareConfig) { $ConfigRepo } else { $null }
  configBaseBranch = $configBaseBranch
  configBranch = $configBranch
  configFile = $configFile
} | ConvertTo-Json
