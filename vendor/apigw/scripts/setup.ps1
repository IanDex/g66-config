param(
  [string]$ConfigRepo,
  [string]$Profile,
  [string]$Region,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$SkillRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Write-Host "Skill root: $SkillRoot"

function Test-Cmd($Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  return [bool]$cmd
}

$missing = @()
foreach ($tool in @("node", "npm", "git", "aws")) {
  if (Test-Cmd $tool) {
    $version = & $tool --version 2>$null
    Write-Host ("[OK] {0} -> {1}" -f $tool, ($version | Select-Object -First 1))
  } else {
    Write-Host ("[MISSING] {0}" -f $tool) -ForegroundColor Yellow
    $missing += $tool
  }
}

if ($missing -contains "node" -or $missing -contains "npm") {
  Write-Error "Install Node.js 18+ (https://nodejs.org/) before continuing."
}
if ($missing -contains "git") {
  Write-Error "Install git before continuing."
}
if ($missing -contains "aws") {
  Write-Warning "AWS CLI not found. Install AWS CLI v2 (https://docs.aws.amazon.com/cli/) before running sync_all_envs.ps1."
}

Push-Location $SkillRoot
try {
  if (-not (Test-Path -LiteralPath (Join-Path $SkillRoot "node_modules")) -or $Force) {
    Write-Host "Running 'npm install'..."
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
  } else {
    Write-Host "node_modules present (use -Force to reinstall)."
  }
} finally {
  Pop-Location
}

$configPath = Join-Path $SkillRoot "apigw-apidoc.config.json"
$examplePath = Join-Path $SkillRoot "apigw-apidoc.config.example.json"

if (-not (Test-Path -LiteralPath $configPath) -or $Force) {
  if (-not (Test-Path -LiteralPath $examplePath)) {
    throw "Missing apigw-apidoc.config.example.json in skill root."
  }
  $cfg = Get-Content -Raw -LiteralPath $examplePath | ConvertFrom-Json

  if (-not $ConfigRepo) {
    $default = Join-Path $env:USERPROFILE "Documents\ms-g66\ms-config-api-gateway"
    $entered = Read-Host "Path to ms-config-api-gateway repo [$default]"
    if ([string]::IsNullOrWhiteSpace($entered)) { $ConfigRepo = $default } else { $ConfigRepo = $entered }
  }
  $cfg.configRepo = $ConfigRepo

  if ($PSBoundParameters.ContainsKey("Profile")) {
    $cfg.profile = $Profile
  }
  if ($PSBoundParameters.ContainsKey("Region")) {
    $cfg.region = $Region
  }

  $cfg | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8
  Write-Host "Wrote $configPath"
} else {
  Write-Host "Config already present at $configPath (use -Force to overwrite)."
}

$cfgFinal = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
$resolvedConfigRepo = [Environment]::ExpandEnvironmentVariables($cfgFinal.configRepo)
if (-not (Test-Path -LiteralPath $resolvedConfigRepo)) {
  Write-Warning "configRepo path does not exist yet: $resolvedConfigRepo. Clone the repo there before running sync_all_envs.ps1."
} else {
  Write-Host "[OK] configRepo exists: $resolvedConfigRepo"
}

Write-Host ""
Write-Host "Setup done. Next steps:"
Write-Host "  1. Ensure AWS CLI is authenticated (aws sts get-caller-identity)."
Write-Host "  2. Ensure git can push to CodeCommit (credential helper or SSO)."
Write-Host "  3. Run: & '$SkillRoot\scripts\sync_all_envs.ps1' -Repo <path-to-ms-service> -Hu <HU>"
