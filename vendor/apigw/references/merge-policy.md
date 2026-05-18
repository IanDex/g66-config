# Merge Policy

Use a conservative merge. The objective is to update endpoint documentation without losing API Gateway integration settings.

## Inputs

The incoming change may be:

- a full Swagger/OpenAPI document containing `paths`
- a partial document containing only `paths`
- a raw object whose top-level keys are path names

## Add

If an incoming path does not exist in the base document, add it exactly as provided.

## Update

If an incoming path already exists, replace only the members present under that path in the incoming document.

For operations such as `get`, `post`, `put`, `delete`, `patch`, `head`, `trace`, or `options`, replace the complete operation object.

Path-level members such as `parameters` are updated only when present in the incoming path object.

## Preserve

Preserve:

- existing paths absent from the incoming change
- operations absent from an incoming path
- `options`/CORS unless `options` is present in the incoming path
- `securityDefinitions`
- `components.securitySchemes`
- `definitions`
- `components`
- root-level `x-amazon-*` blocks
- operation-level `x-amazon-apigateway-integration` unless that operation is explicitly replaced

## Delete

Never infer deletion from absence.

Delete only when the user provides explicit paths to remove or approves full sync mode. Report deletions separately in the summary.

## Conflict Handling

If an incoming operation would replace an existing operation that has `x-amazon-apigateway-integration`, report the operation as modified. This is expected, but the reviewer should inspect the integration before importing to API Gateway.
