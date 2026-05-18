#!/usr/bin/env node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: render_report.mjs <report-input.json>");
  process.exit(2);
}

const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
const findings = (Array.isArray(input.findings) ? input.findings : []).filter((item) => item.isPrLine !== false);
const counts = {
  high: findings.filter((item) => item.severity === "high").length,
  medium: findings.filter((item) => item.severity === "medium").length,
  low: findings.filter((item) => item.severity === "low").length
};
const score = Math.max(0, 100 - counts.high * 15 - counts.medium * 7 - counts.low * 3);

function section(title, severity, empty) {
  const items = findings.filter((item) => item.severity === severity);
  if (items.length === 0) return [`## ${title}`, "", empty].join("\n");
  return [
    `## ${title}`,
    "",
    ...items.map((item) => [
      `### Comentario sugerido`,
      `- Archivo: ${item.filePath}${item.line ? `:${item.line}` : ""}`,
      `- Lineamiento: ${item.guideline || "Pendiente de mapear"}`,
      `- Severidad: ${item.severity}`,
      `- Confianza: ${Math.round((item.confidence ?? 0.7) * 100)}%`,
      `- Evidencia: ${item.evidence || "Sin evidencia textual"}`,
      "",
      `**Comentario:** ${item.comment || item.message}`,
      "",
      `**Sugerencias:** ${item.suggestion || item.recommendation || "Revisar el codigo contra el lineamiento."}`
    ].filter(Boolean).join("\n"))
  ].join("\n\n");
}

const prId = input.prId || "unknown";
const content = [
  `# 🧾 PR Review - ${prId}`,
  "",
  input.repositoryName ? `Repositorio: ${input.repositoryName}` : undefined,
  "",
  "## 📊 Score",
  `- Cumplimiento: ${score}%`,
  `- HIGH: ${counts.high}`,
  `- MEDIUM: ${counts.medium}`,
  `- LOW: ${counts.low}`,
  "",
  "---",
  "",
  section("🚨 Criticos", "high", "Sin hallazgos criticos."),
  "",
  "---",
  "",
  section("⚠️ Medios", "medium", "Sin hallazgos medios."),
  "",
  "---",
  "",
  section("🧠 Observaciones", "low", "Sin observaciones de severidad baja."),
  "",
  "---",
  "",
  "## 📌 Resumen",
  "",
  input.summary || `Se detectaron ${findings.length} hallazgo(s).`,
  ""
].filter((line) => line !== undefined).join("\n");

const outputDir = path.join(os.homedir(), "Documents", "PR Reviews");
await fs.mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `pr-${prId}-review.md`);
await fs.writeFile(outputPath, content, "utf8");
console.log(outputPath);
