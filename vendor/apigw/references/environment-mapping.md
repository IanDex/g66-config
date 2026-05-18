# Environment Mapping

## Repositories

Primary config repository:

```text
$env:USERPROFILE\Documents\ms-g66\ms-config-api-gateway
```

Each YAML file in that repository represents an API Gateway or service config, for example:

```text
company.yaml
admin.yaml
beneficiary.yaml
```

## Branches

Map logical environments to repository branches:

```text
dev  -> development
ci   -> master
prod -> release
```

## Initial Homologation

For the first homologation pass, use `release`/`prod` as the source of truth and align `master`/`ci` and `development`/`dev` from it.

After that initial baseline is committed, treat the repository YAML files as the source of truth, but pull/export from live API Gateway before endpoint changes when the user asks or when there is risk of direct API Gateway edits.

## Live AWS Export

Use `scripts/export_apigw_swagger.mjs` to download the current API Gateway definition.
On Windows, prefer `scripts/export_apigw_swagger.ps1` if Node cannot spawn AWS CLI with the active SSO session.

The script follows this convention (override in `apigw-apidoc.config.json` → `apiNamePattern`):

```text
MS-{Service}-Public-{ENV}
```

Example:

```powershell
node "$env:USERPROFILE\.claude\skills\apigw-apidoc\scripts\export_apigw_swagger.mjs" --service company --env dev --out MS-Company-Public-DEV.json --format json

# El export usa --export-type oas30 (OpenAPI 3.0.1), no swagger (Swagger 2.0)
```

PowerShell equivalent:

```powershell
& "$env:USERPROFILE\.claude\skills\apigw-apidoc\scripts\export_apigw_swagger.ps1" -Service company -Env dev -Out MS-Company-Public-DEV.json -Format json
```

Internally this runs:

```text
aws apigateway get-rest-apis
aws apigateway get-export --export-type swagger --parameters extensions=apigateway
```

Use `--profile` and `--region` when the AWS CLI environment is not already configured.

## Expected Environment Differences

Allow differences in:

- `info.title`
- `info.description` when it contains an environment label
- `info.version`
- Swagger 2.0 `host`
- Swagger 2.0 `basePath` if the environment requires it
- Swagger 2.0 `schemes` if the environment requires it
- OpenAPI 3.x `servers`
- AWS account-specific ARNs
- Cognito user pool ARNs
- Lambda authorizer ARNs
- stage variables
- API Gateway request validator names when environment-specific
- API Gateway binary media types when the live API differs and the user accepts it

Do not normalize or rename `securityDefinitions` or `components.securitySchemes` automatically.
