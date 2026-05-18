#!/usr/bin/env node
import {
  clone,
  getPaths,
  operationKeys,
  parseArgs,
  readDocument,
  stableStringify,
  writeDocumentAsync
} from "./openapi_common.mjs";

const args = parseArgs(process.argv.slice(2));

if (!args.base || !args.incoming || !args.out) {
  console.error(
    "Usage: node merge_openapi_paths.mjs --base base.json --incoming incoming.json --out output.yaml [--mode apigw-to-apigw|service-openapi-to-apigw] [--format yaml|json] [--remove /path,/path2]"
  );
  process.exit(2);
}

const base = await readDocument(args.base);
const incoming = await readDocument(args.incoming);
const incomingPaths = getPaths(incoming);

if (!base.paths || typeof base.paths !== "object") {
  throw new Error("Base document must contain a paths object.");
}
if (!incomingPaths || Object.keys(incomingPaths).length === 0) {
  throw new Error("Incoming document must contain paths or be a paths-only object.");
}

const output = clone(base);
const mode = args.mode || "apigw-to-apigw";
if (mode === "service-openapi-to-apigw" && output.swagger === "2.0" && incoming.components?.schemas) {
  output.definitions = output.definitions || {};
  for (const [name, schema] of Object.entries(incoming.components.schemas)) {
    output.definitions[name] = convertValueForBase(schema, output);
  }
}
const summary = {
  added: [],
  modified: [],
  preserved: [],
  removed: []
};

for (const [route, incomingPath] of Object.entries(incomingPaths)) {
  if (!output.paths[route]) {
    output.paths[route] = clone(convertPathItemForBase(incomingPath, base));
    summary.added.push(route);
    continue;
  }

  let changed = false;
  const targetPath = output.paths[route];
  for (const [member, value] of Object.entries(incomingPath)) {
    const nextValue =
      mode === "service-openapi-to-apigw" && isOperationMember(member)
        ? mergeServiceOperationIntoApigw(targetPath[member], value, base)
        : clone(convertValueForBase(value, base));
    if (stableStringify(targetPath[member]) !== stableStringify(nextValue)) {
      targetPath[member] = nextValue;
      changed = true;
    }
  }

  if (changed) {
    summary.modified.push({
      path: route,
      operations: operationKeys(incomingPath),
      members: Object.keys(incomingPath).filter((key) => !operationKeys(incomingPath).includes(key))
    });
  } else {
    summary.preserved.push(route);
  }
}

if (args.remove) {
  const removals = args.remove
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const route of removals) {
    if (output.paths[route]) {
      delete output.paths[route];
      summary.removed.push(route);
    }
  }
}

const format = args.format || (args.out.toLowerCase().endsWith(".json") ? "json" : "yaml");
await writeDocumentAsync(args.out, output, format);

console.log(JSON.stringify(summary, null, 2));

function isOperationMember(member) {
  return ["get", "put", "post", "delete", "options", "head", "patch", "trace", "x-amazon-apigateway-any-method"].includes(
    member.toLowerCase()
  );
}

function convertPathItemForBase(pathItem, baseDocument) {
  if (mode !== "service-openapi-to-apigw") return pathItem;
  const result = {};
  for (const [member, value] of Object.entries(pathItem)) {
    result[member] = isOperationMember(member)
      ? mergeServiceOperationIntoApigw(undefined, value, baseDocument)
      : convertValueForBase(value, baseDocument);
  }
  return result;
}

function mergeServiceOperationIntoApigw(existingOperation, serviceOperation, baseDocument) {
  const result = clone(existingOperation || {});
  const converted = convertOpenApi3OperationToSwagger2(serviceOperation, baseDocument);

  for (const [key, value] of Object.entries(converted)) {
    if (key === "x-amazon-apigateway-integration") continue;
    if (key === "security" && result.security) continue;
    result[key] = clone(value);
  }

  if (existingOperation?.["x-amazon-apigateway-integration"]) {
    result["x-amazon-apigateway-integration"] = clone(existingOperation["x-amazon-apigateway-integration"]);
  }
  if (existingOperation?.security) {
    result.security = clone(existingOperation.security);
  }
  return result;
}

function convertOpenApi3OperationToSwagger2(operation, baseDocument) {
  const result = clone(operation || {});
  if (result.requestBody) {
    const bodyParam = requestBodyToBodyParameter(result.requestBody, baseDocument);
    delete result.requestBody;
    result.parameters = [...(result.parameters || []), bodyParam];
  }
  if (result.responses) {
    result.responses = convertResponses(result.responses, baseDocument);
  }
  if (result.parameters) {
    result.parameters = result.parameters.map((param) => convertValueForBase(param, baseDocument));
  }
  return convertValueForBase(result, baseDocument);
}

function requestBodyToBodyParameter(requestBody, baseDocument) {
  const content = requestBody.content || {};
  const preferred =
    content["application/json"] ||
    content["application/*+json"] ||
    content[Object.keys(content)[0]] ||
    {};
  return {
    in: "body",
    name: "body",
    required: Boolean(requestBody.required),
    schema: convertValueForBase(preferred.schema || {}, baseDocument)
  };
}

function convertResponses(responses, baseDocument) {
  const result = {};
  for (const [code, response] of Object.entries(responses)) {
    const next = clone(response || {});
    if (next.content) {
      const content = next.content;
      const preferred =
        content["application/json"] ||
        content["application/*+json"] ||
        content[Object.keys(content)[0]] ||
        {};
      if (preferred.schema) next.schema = preferred.schema;
      delete next.content;
    }
    result[code] = convertValueForBase(next, baseDocument);
  }
  return result;
}

function convertValueForBase(value, baseDocument) {
  if (Array.isArray(value)) return value.map((item) => convertValueForBase(item, baseDocument));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "$ref" && typeof item === "string" && baseDocument.swagger === "2.0") {
      result[key] = item.replace("#/components/schemas/", "#/definitions/");
    } else {
      result[key] = convertValueForBase(item, baseDocument);
    }
  }
  return result;
}
