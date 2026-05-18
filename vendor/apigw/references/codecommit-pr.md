# CodeCommit PR Flow

Use one PR per environment.

Branch naming:

```text
{user}/{env}/{HU}
```

Where:

- `{user}` is the person running the command.
- `{env}` is one of `dev`, `ci`, or `prod`.
- `{HU}` is the story or work item. Ask the user if it is missing.

Suggested commit message:

```text
[{HU}]: {pr_title_without_env_prefix}
```

Suggested PR title:

```text
[{env}][{HU}] Add {method path} to {api} API Gateway apidoc
```

For multiple endpoint operations:

```text
[{env}][{HU}] Add {count} API Gateway paths to {api} apidoc
```

The `sync_from_aws.ps1` script writes these files in `OutDir` after a successful merge:

```text
pr-title.txt
pr-description.md
```

Use those generated files as the source of truth for PR creation.

## Corporate PR Body Template

Use this adapted template for apidoc PRs:

```markdown
- **Encargado**: {owner_name}
- **Link historia**: [Enlace Jira](https://global66.atlassian.net/browse/{HU})
- **Descripcion del desarrollo**:
> Updated `{api}.yaml` with the API Gateway apidoc generated from `{api_gateway_name}`. The change adds the following endpoint operation(s) while preserving existing paths, integrations, authorizers, CORS/options, and security definitions:
- `{METHOD path}`
- **Dependencia de uno o varios PRs**: No
- **Requiere creacion de endpoint en API Gateway?**: Si
- **Requiere creacion de columna/as o tabla/as?**: No
- **Datos de columna/as o tabla/as**: No
- **Requiere agregar propiedades al proyecto?**: No

## Validation
- Base Swagger exported from `{api_gateway_name}`
- Merge completed without applying potential removals
- API Gateway validation passed
- Final YAML validated successfully

## Branches
- Source: `{source_branch}`
- Target: `{target_branch}`
```

## Inference Rules

- **Encargado**: infer from the branch user segment. Mapping is read from `apigw-apidoc.config.json` → `owners`; missing entries fall back to the username as-is.
- **Link historia**: use `https://global66.atlassian.net/browse/{HU}`.
- **Descripcion del desarrollo**: summarize the generated apidoc change, including the exact endpoint operation(s).
- **Dependencia de uno o varios PRs**: `No` by default. Use `Si` only if the user explicitly mentioned a dependency.
- **Requiere creacion de endpoint en API Gateway?**: `Si` for this skill when paths were added or modified.
- **Requiere creacion de columna/as o tabla/as?**: `No` for apidoc-only PRs.
- **Datos de columna/as o tabla/as**: `No` for apidoc-only PRs.
- **Requiere agregar propiedades al proyecto?**: `No` for apidoc-only PRs.

## Create Or Update CodeCommit PR

After reviewing and committing the generated `{api}.yaml`, push the branch:

```powershell
git -C "$env:USERPROFILE\Documents\ms-g66\ms-config-api-gateway" push -u origin {source_branch}
```

Detect the AWS region:

```powershell
aws configure get region
```

Check if an open PR already exists for the branch:

```powershell
aws codecommit list-pull-requests --repository-name ms-config-api-gateway --pull-request-status OPEN --region {region}
aws codecommit get-pull-request --pull-request-id {id} --region {region}
```

If an open PR exists for `sourceReference={source_branch}`, update it:

```powershell
aws codecommit update-pull-request-title --pull-request-id {id} --title "{title}" --region {region}
aws codecommit update-pull-request-description --pull-request-id {id} --description "{description}" --region {region}
```

If no open PR exists, create it:

```powershell
aws codecommit create-pull-request --title "{title}" --description "{description}" --targets repositoryName=ms-config-api-gateway,sourceReference={source_branch},destinationReference={target_branch} --region {region}
```

Build the PR URL:

```text
https://{region}.console.aws.amazon.com/codesuite/codecommit/repositories/ms-config-api-gateway/pull-requests/{pullRequestId}/details
```

## Jira Update

If a new PR was created, update the Jira field that matches the environment:

| Environment | Jira field |
|-------------|------------|
| `dev`       | PR en dev  |
| `ci`        | PR en CI   |
| `prod`      | PR en Prod |

Append the new PR URL to the existing field value. Do not overwrite existing PR URLs.
