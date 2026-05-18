#!/usr/bin/env node
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: collect_guidelines.mjs <guideline-dir>");
  process.exit(2);
}

async function walk(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = await walk(path.resolve(dir));
const customPath = path.resolve(process.cwd(), "g66-config", "custom-guidelines.md");
try {
  await fs.stat(customPath);
  if (!files.includes(customPath)) {
    files.unshift(customPath);
  }
} catch {
  // Custom guidelines are optional for inventory, but must be prioritized when present.
}
const documents = [];
for (const filePath of files.sort((a, b) => {
  if (path.basename(a) === "custom-guidelines.md") return -1;
  if (path.basename(b) === "custom-guidelines.md") return 1;
  return a.localeCompare(b);
})) {
  const content = await fs.readFile(filePath, "utf8");
  const headings = content.split(/\r?\n/)
    .filter((line) => /^#{1,4}\s+/.test(line))
    .slice(0, 30)
    .map((line) => line.trim());
  documents.push({
    filePath,
    name: path.basename(filePath),
    hash: createHash("sha256").update(content).digest("hex"),
    bytes: Buffer.byteLength(content),
    headings
  });
}

console.log(JSON.stringify({ guidelineDir: path.resolve(dir), count: documents.length, documents }, null, 2));
