#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "./openapi_common.mjs";

const args = parseArgs(process.argv.slice(2));

if ((!args.service && !args["api-name"]) || !args.env) {
  console.error(
    "Usage: node export_apigw_swagger.mjs --service company --env dev [--out file.json] [--stage dev] [--profile name] [--region us-east-1] [--format json|yaml]"
  );
  process.exit(2);
}

const env = args.env;
const stage = args.stage || env;
const format = (args.format || "json").toLowerCase();
const apiName = args["api-name"] || buildApiName(args.service, env);
const out =
  args.out ||
  `${apiName}.${format === "yaml" || format === "yml" ? "yaml" : "json"}`;

const commonAwsArgs = [];
if (args.profile) commonAwsArgs.push("--profile", args.profile);
if (args.region) commonAwsArgs.push("--region", args.region);

console.error(`Looking for API Gateway: ${apiName}`);
const apiIdResult = runAws([
  "apigateway",
  "get-rest-apis",
  "--query",
  `items[?name=='${apiName}'].id | [0]`,
  "--output",
  "text",
  ...commonAwsArgs
]);

const apiId = apiIdResult.stdout.trim();
if (!apiId || apiId === "None") {
  console.error(`API Gateway not found: ${apiName}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

const accepts = format === "yaml" || format === "yml" ? "application/yaml" : "application/json";
runAws(
  [
    "apigateway",
    "get-export",
    "--rest-api-id",
    apiId,
    "--stage-name",
    stage,
    "--export-type",
    "oas30",
    "--parameters",
    "extensions=apigateway",
    "--accepts",
    accepts,
    ...commonAwsArgs,
    out
  ],
  { inherit: true }
);

console.log(
  JSON.stringify(
    {
      apiName,
      apiId,
      env,
      stage,
      format,
      out
    },
    null,
    2
  )
);

function buildApiName(service, environment) {
  const serviceFormatted = service.charAt(0).toUpperCase() + service.slice(1);
  return `MS-${serviceFormatted}-Public-${environment.toUpperCase()}`;
}

function runAws(awsArgs, options = {}) {
  const result = spawnSync("aws", awsArgs, {
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"]
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (!options.inherit) {
      if (result.stdout) console.error(result.stdout);
      if (result.stderr) console.error(result.stderr);
    }
    process.exit(result.status || 1);
  }
  return result;
}
