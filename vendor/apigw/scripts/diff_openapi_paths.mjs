#!/usr/bin/env node
import {
  getPaths,
  operationKeys,
  parseArgs,
  readDocument,
  stableStringify
} from "./openapi_common.mjs";

const args = parseArgs(process.argv.slice(2));

if (!args.base || !args.incoming) {
  console.error("Usage: node diff_openapi_paths.mjs --base base.json --incoming incoming.json [--json]");
  process.exit(2);
}

const base = await readDocument(args.base);
const incoming = await readDocument(args.incoming);
const basePaths = getPaths(base);
const incomingPaths = getPaths(incoming);

const added = [];
const removedPotential = [];
const modified = [];
const unchanged = [];

for (const route of Object.keys(incomingPaths).sort()) {
  if (!basePaths[route]) {
    added.push(route);
    continue;
  }
  const basePath = basePaths[route];
  const incomingPath = incomingPaths[route];
  const changedOps = [];
  for (const op of operationKeys(incomingPath)) {
    if (stableStringify(basePath[op]) !== stableStringify(incomingPath[op])) {
      changedOps.push(op);
    }
  }
  const nonOperationChanges = Object.keys(incomingPath).filter(
    (key) => !operationKeys(incomingPath).includes(key) &&
      stableStringify(basePath[key]) !== stableStringify(incomingPath[key])
  );
  if (changedOps.length > 0 || nonOperationChanges.length > 0) {
    modified.push({ path: route, operations: changedOps, pathMembers: nonOperationChanges });
  } else {
    unchanged.push(route);
  }
}

for (const route of Object.keys(basePaths).sort()) {
  if (!incomingPaths[route]) removedPotential.push(route);
}

const result = {
  added,
  modified,
  unchanged,
  removedPotential,
  counts: {
    added: added.length,
    modified: modified.length,
    unchanged: unchanged.length,
    removedPotential: removedPotential.length
  }
};

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Added paths: ${result.counts.added}`);
  console.log(`Modified paths: ${result.counts.modified}`);
  console.log(`Unchanged paths: ${result.counts.unchanged}`);
  console.log(`Potential removals, not applied by merge: ${result.counts.removedPotential}`);
  for (const item of added.slice(0, 20)) console.log(`  + ${item}`);
  for (const item of modified.slice(0, 20)) {
    console.log(`  ~ ${item.path} ${item.operations.join(",")}`);
  }
  for (const item of removedPotential.slice(0, 20)) console.log(`  ? ${item}`);
}
