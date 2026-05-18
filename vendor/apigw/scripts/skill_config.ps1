function Expand-SkillPath {
  param([string]$Value)
  if (-not $Value) { return $Value }
  return [Environment]::ExpandEnvironmentVariables($Value)
}

function Get-SkillRoot {
  param([string]$ScriptPath)
  return (Split-Path -Parent (Split-Path -Parent $ScriptPath))
}

function Get-SkillConfig {
  param([string]$SkillRoot)
  $configPath = Join-Path $SkillRoot "apigw-apidoc.config.json"
  if (Test-Path -LiteralPath $configPath) {
    try {
      return Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    } catch {
      Write-Warning "apigw-apidoc.config.json invalid JSON: $($_.Exception.Message). Ignoring."
    }
  }
  return $null
}

function Resolve-ConfigRepo {
  param(
    [string]$ParamValue,
    [string]$SkillRoot
  )
  if ($ParamValue) { return (Expand-SkillPath $ParamValue) }
  if ($env:APIGW_APIDOC_CONFIG_REPO) { return (Expand-SkillPath $env:APIGW_APIDOC_CONFIG_REPO) }
  $cfg = Get-SkillConfig -SkillRoot $SkillRoot
  if ($cfg -and $cfg.configRepo) { return (Expand-SkillPath $cfg.configRepo) }
  return (Join-Path $env:USERPROFILE "Documents\ms-g66\ms-config-api-gateway")
}

function Resolve-Profile {
  param([string]$ParamValue, [string]$SkillRoot)
  if ($ParamValue) { return $ParamValue }
  if ($env:APIGW_APIDOC_PROFILE) { return $env:APIGW_APIDOC_PROFILE }
  $cfg = Get-SkillConfig -SkillRoot $SkillRoot
  if ($cfg -and $cfg.profile) { return $cfg.profile }
  return $null
}

function Resolve-Region {
  param([string]$ParamValue, [string]$SkillRoot)
  if ($ParamValue) { return $ParamValue }
  if ($env:APIGW_APIDOC_REGION) { return $env:APIGW_APIDOC_REGION }
  $cfg = Get-SkillConfig -SkillRoot $SkillRoot
  if ($cfg -and $cfg.region) { return $cfg.region }
  return $null
}

function Get-OwnerName {
  param([string]$User, [string]$SkillRoot)
  $cfg = Get-SkillConfig -SkillRoot $SkillRoot
  if ($cfg -and $cfg.owners -and $cfg.owners.PSObject.Properties[$User]) {
    return $cfg.owners.$User
  }
  return $User
}

function Get-JiraBaseUrl {
  param([string]$SkillRoot)
  $cfg = Get-SkillConfig -SkillRoot $SkillRoot
  if ($cfg -and $cfg.jiraBaseUrl) { return $cfg.jiraBaseUrl.TrimEnd("/") }
  return "https://global66.atlassian.net/browse"
}

function Get-ApiNamePattern {
  param([string]$SkillRoot)
  $cfg = Get-SkillConfig -SkillRoot $SkillRoot
  if ($cfg -and $cfg.apiNamePattern) { return $cfg.apiNamePattern }
  return "MS-{Service}-Public-{ENV}"
}
