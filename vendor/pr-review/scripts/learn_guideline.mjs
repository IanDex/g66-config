#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const workspace = process.argv[2];
const description = process.argv.slice(3).join(" ").trim();
if (!workspace || !description) {
  console.error("Usage: learn_guideline.mjs <workspace> <description>");
  process.exit(2);
}

const customPath = path.resolve(workspace, "g66-config", "custom-guidelines.md");
await fs.mkdir(path.dirname(customPath), { recursive: true });

try {
  await fs.stat(customPath);
} catch {
  await fs.writeFile(customPath, [
    "# Custom G66 PR Review Guidelines",
    "",
    "These guidelines have priority over the general G66 lineamientos. They capture team review experience and must always be evaluated first.",
    ""
  ].join("\n"), "utf8");
}

const timestamp = new Date().toISOString();
await fs.appendFile(customPath, [
  "",
  `## Learned guideline - ${timestamp}`,
  "",
  "Severity: medium",
  "",
  "Human feedback:",
  "",
  description,
  "",
  "Review rule:",
  "",
  "- Detect similar cases in future PRs using semantic context, surrounding code, and naming intent.",
  "- Include evidence, confidence, and a concrete suggestion.",
  ""
].join("\n"), "utf8");

console.log(customPath);
