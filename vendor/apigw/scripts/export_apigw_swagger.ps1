param(
  [string]$Service,
  [string]$Env,
  [string]$ApiName,
  [string]$Stage,
  [string]$Out,
  [string]$Format = "json",
  [string]$Profile,
  [string]$Region
)

$ErrorActionPreference = "Stop"

$SkillRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $SkillRoot "scripts\skill_config.ps1")

if (-not $Profile) { $Profile = Resolve-Profile -ParamValue $Profile -SkillRoot $SkillRoot }
if (-not $Region) { $Region = Resolve-Region -ParamValue $Region -SkillRoot $SkillRoot }

if (-not $ApiName) {
  if (-not $Service -or -not $Env) {
    Write-Error "Usage: .\export_apigw_swagger.ps1 -Service company -Env dev [-Out file.json] [-Stage dev] [-Profile profile] [-Region us-east-1] [-Format json|yaml]"
  }
  $serviceName = $Service.Substring(0, 1).ToUpperInvariant() + $Service.Substring(1)
  $apiPattern = Get-ApiNamePattern -SkillRoot $SkillRoot
  $ApiName = $apiPattern.Replace("{Service}", $serviceName).Replace("{ENV}", $Env.ToUpperInvariant())
}

if (-not $Stage) {
  $Stage = $Env
}

if (-not $Out) {
  $extension = if ($Format -in @("yaml", "yml")) { "yaml" } else { "json" }
  $Out = "$ApiName.$extension"
}

$commonArgs = @()
if ($Profile) {
  $commonArgs += @("--profile", $Profile)
}
if ($Region) {
  $commonArgs += @("--region", $Region)
}

Write-Host "Looking for API Gateway: $ApiName"
$apisJson = & aws apigateway get-rest-apis --query "items[].{id:id,name:name}" --output json @commonArgs
$apis = $apisJson | ConvertFrom-Json
$api = $apis | Where-Object { $_.name -eq $ApiName } | Select-Object -First 1
$apiId = if ($api) { $api.id } else { "" }

if (-not $apiId -or $apiId -eq "None") {
  Write-Error "API Gateway not found: $ApiName"
}

$accepts = if ($Format -in @("yaml", "yml")) { "application/yaml" } else { "application/json" }
$outDir = Split-Path -Parent (Resolve-Path -LiteralPath .)
if (Split-Path -Parent $Out) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Out) | Out-Null
}

Write-Host "Exporting API ID $apiId stage $Stage to $Out"
& aws apigateway get-export `
  --rest-api-id $apiId `
  --stage-name $Stage `
  --export-type oas30 `
  --parameters extensions=apigateway `
  --accepts $accepts `
  @commonArgs `
  $Out | Out-Host

@{
  apiName = $ApiName
  apiId = $apiId
  env = $Env
  stage = $Stage
  format = $Format
  out = $Out
} | ConvertTo-Json
