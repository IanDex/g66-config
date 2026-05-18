#!/usr/bin/env node
import {
  HTTP_METHODS,
  collectDeclaredPathParams,
  getSecurityDefinitions,
  isOperationKey,
  operationKeys,
  parseArgs,
  pathParamsFromTemplate,
  readDocument
} from "./openapi_common.mjs";

const args = parseArgs(process.argv.slice(2));
const target = args._?.[0] || args.file;

if (!target) {
  console.error("Usage: node validate_openapi_apigw.mjs file.json|file.yaml [--json] [--incoming new-paths.json]");
  process.exit(2);
}

const document = await readDocument(target);
const errors = [];
const warnings = [];

// Paths present in --incoming are strictly validated; pre-existing paths only warn.
let strictPaths = null;
if (args.incoming) {
  try {
    const inc = await readDocument(args.incoming);
    const incPaths = inc?.paths ? Object.keys(inc.paths) : (Array.isArray(inc) ? inc : []);
    strictPaths = new Set(incPaths);
  } catch { /* ignore, fall back to strict-all */ }
}

if (!document || typeof document !== "object") {
  errors.push("Document root must be an object.");
}

const version = document.openapi || document.swagger;
if (!version) {
  errors.push("Missing openapi or swagger version.");
}
if (document.swagger && String(document.swagger) !== "2.0") {
  warnings.push(`Unexpected swagger version: ${document.swagger}`);
}

if (!document.paths || typeof document.paths !== "object") {
  errors.push("Missing paths object.");
}

const securityDefinitions = getSecurityDefinitions(document);
if (Object.keys(securityDefinitions).length === 0) {
  warnings.push("No securityDefinitions/components.securitySchemes found.");
}

const isOas3 = Boolean(document.openapi);
if (isOas3) {
  if (!document.components?.schemas?.Empty) {
    warnings.push("Missing components.schemas.Empty — $ref '#/components/schemas/Empty' will be unresolvable in API Gateway.");
  }
}

if (document.paths && typeof document.paths === "object") {
  for (const [route, pathItem] of Object.entries(document.paths)) {
    const isStrict = !strictPaths || strictPaths.has(route);
    const pushIssue = (msg) => isStrict ? errors.push(msg) : warnings.push(`[existing] ${msg}`);

    if (!route.startsWith("/")) {
      errors.push(`Path does not start with '/': ${route}`);
      continue;
    }
    if (!pathItem || typeof pathItem !== "object") {
      errors.push(`Path item must be an object: ${route}`);
      continue;
    }

    for (const member of Object.keys(pathItem)) {
      if (!isOperationKey(member) && member !== "parameters" && !member.startsWith("x-")) {
        warnings.push(`Non-operation member at ${route}: ${member}`);
      }
    }

    for (const method of operationKeys(pathItem)) {
      const operation = pathItem[method];
      const label = `${method.toUpperCase()} ${route}`;
      if (!operation || typeof operation !== "object") {
        errors.push(`Operation must be an object: ${label}`);
        continue;
      }
      if (!operation.responses || typeof operation.responses !== "object") {
        pushIssue(`Missing responses: ${label}`);
      }

      const expectedParams = pathParamsFromTemplate(route);
      const declaredParams = collectDeclaredPathParams(pathItem, operation);
      for (const param of expectedParams) {
        if (!declaredParams.has(param)) {
          pushIssue(`Missing path parameter '${param}' in ${label}`);
        }
      }

      const integration = operation["x-amazon-apigateway-integration"];
      if (!integration) {
        warnings.push(`Missing x-amazon-apigateway-integration: ${label}`);
      } else if (!integration.type) {
        pushIssue(`Missing integration type: ${label}`);
      }

      if (method.toLowerCase() === "options" && integration && integration.type !== "mock") {
        warnings.push(`OPTIONS integration is not mock: ${label}`);
      }
    }
  }
}

const result = {
  valid: errors.length === 0,
  errors,
  warnings,
  counts: {
    errors: errors.length,
    warnings: warnings.length,
    paths: document.paths ? Object.keys(document.paths).length : 0
  }
};

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(result.valid ? "VALID" : "INVALID");
  console.log(`Paths: ${result.counts.paths}`);
  console.log(`Errors: ${result.counts.errors}`);
  for (const error of errors.slice(0, 50)) console.log(`  ERROR ${error}`);
  console.log(`Warnings: ${result.counts.warnings}`);
  for (const warning of warnings.slice(0, 50)) console.log(`  WARN ${warning}`);
}

process.exit(result.valid ? 0 : 1);
