import { Command } from "commander";
import { spawnSync, execSync } from "child_process";
import chalk from "chalk";
import * as path from "path";

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "pr_review.py");

function inferRepo(): string | null {
  try {
    return path.basename(
      execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim()
    );
  } catch {
    return null;
  }
}

function inferPrFromBranch(region: string, repo: string): string | null {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
    const result = spawnSync(
      "aws",
      ["codecommit", "list-pull-requests", "--repository-name", repo,
       "--pull-request-status", "OPEN", "--region", region],
      { encoding: "utf-8" }
    );
    if (result.status !== 0) return null;
    const ids: string[] = JSON.parse(result.stdout).pullRequestIds ?? [];
    for (const id of ids) {
      const detail = spawnSync(
        "aws",
        ["codecommit", "get-pull-request", "--pull-request-id", id, "--region", region],
        { encoding: "utf-8" }
      );
      if (detail.status !== 0) continue;
      const pr = JSON.parse(detail.stdout).pullRequest;
      for (const t of pr.pullRequestTargets ?? []) {
        const src = t.sourceReference?.replace("refs/heads/", "");
        if (src === branch) return id;
      }
    }
  } catch {
    return null;
  }
  return null;
}

const prReview = new Command("pr-review")
  .description("🔍 Review de PR con análisis estático + IA contra lineamientos G66")
  .option("--pr <id>",          "ID del PR en CodeCommit (se infiere de la rama si omitido)")
  .option("--repo <name>",      "Nombre del repositorio (se infiere del directorio)")
  .option("--region <region>",  "AWS region", "us-east-1")
  .option("--lineamientos <path>", "Ruta a los lineamientos G66")
  .option("--dry-run",          "Solo analizar diff sin llamar a la IA")
  .action(async (opts) => {
    const repo = opts.repo ?? inferRepo();
    if (!repo) {
      console.error(chalk.red("❌ No se pudo inferir el repositorio. Usa --repo."));
      process.exit(1);
    }

    let prId = opts.pr;
    if (!prId) {
      console.log(chalk.dim("  Buscando PR abierto para la rama actual..."));
      prId = inferPrFromBranch(opts.region, repo);
      if (!prId) {
        console.error(chalk.red("❌ No se encontró PR abierto para esta rama. Usa --pr <id>."));
        process.exit(1);
      }
      console.log(chalk.blue(`  PR inferido: #${prId}`));
    }

    console.log(chalk.blue(`\n📋 Revisando PR #${prId} en ${repo}...\n`));
    console.log(chalk.dim("  Analizando diff..."));

    const pyArgs = ["--pr", prId, "--repo", repo, "--region", opts.region];
    if (opts.lineamientos) pyArgs.push("--lineamientos", opts.lineamientos);
    if (opts.dryRun)        pyArgs.push("--dry-run");

    const result = spawnSync("python", [SCRIPT, ...pyArgs], {
      encoding: "utf-8",
      stdio: ["inherit", "pipe", "inherit"],
    });

    if (!result.stdout?.trim()) {
      console.error(chalk.red("❌ El script no retornó respuesta."));
      process.exit(1);
    }

    let data: any;
    try {
      data = JSON.parse(result.stdout.trim());
    } catch {
      console.error(chalk.red("❌ Respuesta inválida del script."));
      process.exit(1);
    }

    if (!data.ok) {
      console.error(chalk.red(`❌ ${data.error}`));
      process.exit(1);
    }

    if (opts.dryRun) {
      console.log(chalk.yellow("\n[dry-run]"));
      console.log(`  Diff lines: ${data.diff_lines}`);
      console.log(`  Static findings: ${data.static_findings}`);
      return;
    }

    const scoreColor = data.score >= 80 ? chalk.green : data.score >= 60 ? chalk.yellow : chalk.red;

    console.log(chalk.bold.cyan(`\n📊 Score: ${scoreColor(data.score + "%")}`));
    console.log(`  🚨 HIGH:   ${data.high}`);
    console.log(`  ⚠️  MEDIUM: ${data.medium}`);
    console.log(`  🧠 LOW:    ${data.low}`);
    console.log(`  Total:    ${data.findings} hallazgo(s)\n`);
    console.log(chalk.bold(`📝 PR: ${data.pr_title}`));
    console.log(chalk.green(`\n✅ Reporte guardado en:\n   ${data.report_path}\n`));
  });

export default prReview;
