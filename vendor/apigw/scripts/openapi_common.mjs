import fs from "node:fs";
import path from "node:path";

export const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace"
]);

export const API_GATEWAY_OPERATION_EXTENSIONS = new Set([
  "x-amazon-apigateway-any-method"
]);

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      if (!args._) args._ = [];
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

export async function readDocument(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`Empty file: ${filePath}`);
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  try {
    const yaml = await import("yaml");
    return yaml.parse(raw);
  } catch (error) {
    throw new Error(
      `Cannot parse YAML file ${filePath}. Run npm install in the skill folder to install the optional yaml dependency. Original error: ${error.message}`
    );
  }
}

export function writeDocument(filePath, document, format = "yaml") {
  const normalized = format.toLowerCase();
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  if (normalized === "json") {
    fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    return;
  }
  fs.writeFileSync(filePath, `${toYaml(document)}\n`, "utf8");
}

export async function writeDocumentAsync(filePath, document, format = "yaml") {
  const normalized = format.toLowerCase();
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  if (normalized === "json") {
    fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    return;
  }
  try {
    const yaml = await import("yaml");
    fs.writeFileSync(filePath, yaml.stringify(document), "utf8");
  } catch {
    fs.writeFileSync(filePath, `${toYaml(document)}\n`, "utf8");
  }
}

export function getPaths(document) {
  if (!document || typeof document !== "object") return {};
  if (document.paths && typeof document.paths === "object") return document.paths;
  const keys = Object.keys(document);
  if (keys.length > 0 && keys.every((key) => key.startsWith("/"))) return document;
  return {};
}

export function normalizeDocument(document) {
  const copy = clone(document);
  delete copy.info?.version;
  delete copy.info?.["x-generated-at"];
  delete copy["x-generated-at"];
  delete copy["x-amazon-apigateway-importexport-version"];
  return sortDeep(copy);
}

export function sortDeep(value) {
  if (Array.isArray(value)) return value.map((item) => sortDeep(item));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    result[key] = sortDeep(value[key]);
  }
  return result;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function operationKeys(pathItem) {
  if (!pathItem || typeof pathItem !== "object") return [];
  return Object.keys(pathItem).filter((key) => isOperationKey(key));
}

export function isOperationKey(key) {
  return HTTP_METHODS.has(key.toLowerCase()) || API_GATEWAY_OPERATION_EXTENSIONS.has(key);
}

export function pathParamsFromTemplate(route) {
  const params = [];
  const regex = /\{([^}]+)\}/g;
  let match;
  while ((match = regex.exec(route)) !== null) {
    params.push(match[1]);
  }
  return params;
}

export function collectDeclaredPathParams(pathItem, operation) {
  const declared = new Set();
  for (const source of [pathItem?.parameters, operation?.parameters]) {
    if (!Array.isArray(source)) continue;
    for (const param of source) {
      if (param && param.in === "path" && param.name) declared.add(param.name);
    }
  }
  return declared;
}

export function getSecurityDefinitions(document) {
  if (document?.securityDefinitions && typeof document.securityDefinitions === "object") {
    return document.securityDefinitions;
  }
  if (
    document?.components?.securitySchemes &&
    typeof document.components.securitySchemes === "object"
  ) {
    return document.components.securitySchemes;
  }
  return {};
}

export function serviceNameFromRepoName(repoName) {
  return repoName.startsWith("ms-") ? repoName.slice(3) : repoName;
}

export function branchToEnv(branch) {
  if (branch === "development" || branch === "dev") return "dev";
  if (branch === "master" || branch === "ci") return "ci";
  if (branch === "release" || branch === "prod") return "prod";
  const lowered = String(branch || "").toLowerCase();
  if (lowered.includes("/dev/") || lowered.includes("/development/")) return "dev";
  if (lowered.includes("/ci/") || lowered.includes("/master/")) return "ci";
  if (lowered.includes("/prod/") || lowered.includes("/release/")) return "prod";
  return null;
}

export function envToBranch(env) {
  if (env === "dev") return "development";
  if (env === "ci") return "master";
  if (env === "prod") return "release";
  return env;
}

function toYaml(value, indent = 0) {
  const pad = " ".repeat(indent);
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return scalar(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          return renderArrayObject(item, indent);
        }
        return `${pad}- ${scalar(item)}`;
      })
      .join("\n");
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  return entries
    .map(([key, item]) => {
      const renderedKey = renderKey(key);
      if (item && typeof item === "object") {
        const rendered = toYaml(item, indent + 2);
        if (isEmptyCollection(item)) {
          return `${pad}${renderedKey}: ${rendered}`;
        }
        return `${pad}${renderedKey}:\n${rendered}`;
      }
      return `${pad}${renderedKey}: ${scalar(item)}`;
    })
    .join("\n");
}

function renderArrayObject(item, indent) {
  const pad = " ".repeat(indent);
  const childPad = " ".repeat(indent + 2);
  const entries = Object.entries(item);
  if (entries.length === 0) return `${pad}- {}`;

  return entries
    .map(([key, value], index) => {
      const prefix = index === 0 ? `${pad}- ` : childPad;
      const renderedKey = renderKey(key);
      if (value && typeof value === "object") {
        const rendered = toYaml(value, indent + 4);
        if (isEmptyCollection(value)) {
          return `${prefix}${renderedKey}: ${rendered}`;
        }
        return `${prefix}${renderedKey}:\n${rendered}`;
      }
      return `${prefix}${renderedKey}: ${scalar(value)}`;
    })
    .join("\n");
}

function isEmptyCollection(value) {
  return (
    value &&
    typeof value === "object" &&
    Object.keys(value).length === 0
  );
}

function renderKey(key) {
  if (/^[A-Za-z_./${}*-][A-Za-z0-9_./${}:*-]*$/.test(key)) return key;
  return JSON.stringify(key);
}

function scalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value));
}
