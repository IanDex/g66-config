#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  clone,
  getPaths,
  operationKeys,
  parseArgs,
  pathParamsFromTemplate,
  readDocument,
  writeDocumentAsync
} from "./openapi_common.mjs";

const args = parseArgs(process.argv.slice(2));

if (!args.repo || !args.base || !args.out) {
  console.error(
    "Usage: node extract_new_paths_from_diff.mjs --repo C:\\path\\ms-company --base current-swagger.json --out new-paths.json [--ref HEAD]"
  );
  process.exit(2);
}

const repo = path.resolve(args.repo);
const ref = args.ref || "HEAD";
const baseSwagger = await readDocument(args.base);
const basePaths = getPaths(baseSwagger);
const changedJavaFiles = git(repo, ["diff", "--name-only", ref, "HEAD", "--", "*.java"])
  .stdout.split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const detected = [];
for (const relativeFile of changedJavaFiles) {
  const absoluteFile = path.join(repo, relativeFile);
  if (!fs.existsSync(absoluteFile)) continue;
  const content = fs.readFileSync(absoluteFile, "utf8");
  const isController = content.includes("@RestController") || content.includes("@Controller");
  const isApiInterface = content.includes("interface ") && content.includes("@RequestMapping");
  if (!isController && !isApiInterface) continue;

  const basePath = findClassRequestMapping(content);
  const diff = git(repo, ["diff", "--unified=0", ref, "HEAD", "--", relativeFile]).stdout;
  for (const mapping of findAddedMappings(diff)) {
    const route = normalizeRoute(`${basePath}${mapping.subPath}`);
    detected.push({
      file: relativeFile,
      method: mapping.method,
      path: route
    });
  }
}

const output = { paths: {} };
const warnings = [];

for (const endpoint of detected) {
  const templateRoute = findTemplateRoute(basePaths, endpoint);
  if (!templateRoute) {
    warnings.push(`No template found for ${endpoint.method.toUpperCase()} ${endpoint.path}`);
    output.paths[endpoint.path] = buildMinimalPathItem(endpoint, baseSwagger);
    continue;
  }
  const templatePathItem = basePaths[templateRoute];
  const newPathItem = clone(templatePathItem);
  rewritePathItem(newPathItem, templateRoute, endpoint.path, endpoint.method);
  output.paths[endpoint.path] = newPathItem;
}

await writeDocumentAsync(args.out, output, args.out.toLowerCase().endsWith(".json") ? "json" : "yaml");

console.log(
  JSON.stringify(
    {
      repo,
      ref,
      changedJavaFiles,
      detected,
      pathsWritten: Object.keys(output.paths).length,
      out: args.out,
      warnings
    },
    null,
    2
  )
);

function git(repoPath, gitArgs) {
  const normalized = repoPath.replaceAll("\\", "/");
  const result = spawnSync("git", ["-c", `safe.directory=${normalized}`, "-C", repoPath, ...gitArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${gitArgs.join(" ")} failed`);
  }
  return result;
}

function findClassRequestMapping(content) {
  const classIndex = content.search(/\bclass\s+\w+/);
  const beforeClass = classIndex >= 0 ? content.slice(0, classIndex) : content;
  const matches = [...beforeClass.matchAll(/@RequestMapping\s*(?:\(\s*)?(?:"([^"]+)"|value\s*=\s*"([^"]+)"|path\s*=\s*"([^"]+)")/g)];
  const last = matches.at(-1);
  return last ? (last[1] || last[2] || last[3] || "") : "";
}

function findAddedMappings(diff) {
  const result = [];
  const regex = /^\+\s*@(?<kind>GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)(?:\s*\((?<args>.*)\))?/gm;
  let match;
  while ((match = regex.exec(diff)) !== null) {
    const method = match.groups.kind.replace("Mapping", "").toLowerCase();
    const argsText = match.groups.args || "";
    const subPathMatch =
      argsText.match(/"([^"]*)"/) ||
      argsText.match(/(?:value|path)\s*=\s*"([^"]*)"/);
    const subPath = subPathMatch ? subPathMatch[1] : "";
    result.push({ method, subPath });
  }
  return result;
}

function normalizeRoute(route) {
  const normalized = route.replaceAll("//", "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function findTemplateRoute(paths, endpoint) {
  const endpointParams = pathParamsFromTemplate(endpoint.path).sort().join(",");
  const candidates = Object.entries(paths)
    .filter(([, pathItem]) => pathItem?.[endpoint.method])
    .map(([route]) => ({
      route,
      score:
        commonPrefixLength(route, endpoint.path) +
        (pathParamsFromTemplate(route).sort().join(",") === endpointParams ? 1000 : 0)
    }))
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.route || null;
}

function commonPrefixLength(a, b) {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
}

function rewritePathItem(pathItem, oldRoute, newRoute, method) {
  for (const operationKey of operationKeys(pathItem)) {
    if (operationKey !== method && operationKey !== "options") continue;
    const operation = pathItem[operationKey];
    rewriteOperation(operation, oldRoute, newRoute);
  }
}

function rewriteOperation(operation, oldRoute, newRoute) {
  const integration = operation?.["x-amazon-apigateway-integration"];
  if (integration?.uri) {
    integration.uri = integration.uri.replace(oldRoute, newRoute);
  }

  const newParams = pathParamsFromTemplate(newRoute);
  const oldParams = pathParamsFromTemplate(oldRoute);
  if (newParams.length > 0) {
    operation.parameters = (operation.parameters || []).filter((param) => param.in !== "path");
    for (const param of newParams) {
      operation.parameters.push({
        name: param,
        in: "path",
        required: true,
        schema: { type: "string" }
      });
    }
  }

  if (integration?.requestParameters) {
    for (const oldParam of oldParams) {
      delete integration.requestParameters[`integration.request.path.${oldParam}`];
    }
    for (const newParam of newParams) {
      integration.requestParameters[`integration.request.path.${newParam}`] = `method.request.path.${newParam}`;
    }
  }
}

function buildMinimalPathItem(endpoint, baseDoc) {
  const params = pathParamsFromTemplate(endpoint.path).map((param) => ({
    name: param,
    in: "path",
    required: true,
    schema: { type: "string" }
  }));

  const operation = {
    responses: {
      "200": {
        description: "200 response",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Empty" }
          }
        }
      }
    },
    "x-amazon-apigateway-integration": buildMinimalIntegration(endpoint, baseDoc)
  };
  if (params.length > 0) operation.parameters = params;

  return {
    [endpoint.method]: operation,
    options: buildDefaultOptions(params)
  };
}

function buildMinimalIntegration(endpoint, baseDoc) {
  const basePath = baseDoc?.servers?.[0]?.variables?.basePath?.default || "";
  const stageVar = basePath
    ? "url" + basePath.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("") + "Private"
    : "urlServicePrivate";
  const uri = basePath
    ? `https://\${stageVariables.${stageVar}}/${basePath}${endpoint.path}`
    : `https://\${stageVariables.${stageVar}}${endpoint.path}`;

  const requestParameters = {
    "integration.request.header.X-Amzn-Request-Id": "context.requestId",
    "integration.request.header.KNOWN-TOKEN-KEY": "stageVariables.knownTokenKey"
  };
  for (const param of pathParamsFromTemplate(endpoint.path)) {
    requestParameters[`integration.request.path.${param}`] = `method.request.path.${param}`;
  }

  return {
    uri,
    connectionId: "${stageVariables.vpcLink}",
    httpMethod: endpoint.method.toUpperCase(),
    responses: { default: { statusCode: "200" } },
    requestParameters,
    connectionType: "VPC_LINK",
    passthroughBehavior: "when_no_match",
    responseTransferMode: "BUFFERED",
    type: "http_proxy"
  };
}

function buildDefaultOptions(params) {
  const result = {
    responses: {
      "200": {
        description: "200 response",
        headers: {
          "Access-Control-Allow-Origin": { schema: { type: "string" } },
          "Access-Control-Allow-Methods": { schema: { type: "string" } },
          "Access-Control-Allow-Headers": { schema: { type: "string" } }
        },
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Empty" }
          }
        }
      }
    },
    "x-amazon-apigateway-integration": {
      responses: {
        default: {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Methods": "'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT'",
            "method.response.header.Access-Control-Allow-Headers":
              "'Authorization,Content-Type,X-Amz-Date,X-Amz-Security-Token,X-Api-Key,X-B3-Sampled,X-B3-SpanId,X-B3-TraceId,b3,traceparent,tracestate,x-datadog-origin,x-datadog-parent-id,x-datadog-sampling-priority,x-datadog-trace-id'",
            "method.response.header.Access-Control-Allow-Origin": "'*'"
          }
        }
      },
      requestTemplates: { "application/json": '{"statusCode": 200}' },
      passthroughBehavior: "when_no_match",
      type: "mock"
    }
  };
  if (params.length > 0) result.parameters = params;
  return result;
}
