import { Command } from "commander";
import { spawnSync } from "child_process";
import inquirer from "inquirer";
import chalk from "chalk";
import * as path from "path";

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "release_context.py");

function callScript(pyArgs: string[]): { data: any; ok: boolean } {
  const result = spawnSync("python", [SCRIPT, ...pyArgs], {
    encoding: "utf-8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  const raw = result.stdout?.trim() || result.stderr?.trim();
  if (!raw) return { data: null, ok: false };
  try {
    const data = JSON.parse(raw);
    return { data, ok: !!data };
  } catch {
    return { data: null, ok: false };
  }
}

const release = new Command("release")
  .description("🚀 Genera changelog, bump version y crea PR master→release en CodeCommit")
  .option("--region <region>", "AWS region", "us-east-1")
  .option("--version <ver>",   "Nueva versión (ej: 2.1.0); si no se pasa, bump patch automático")
  .option("--dry-run",         "Solo mostrar el changelog sin crear PR ni modificar pom.xml")
  .action(async (opts) => {
    const cwd = process.cwd();
    console.log(chalk.dim(`\n  Analizando commits para release en ${path.basename(cwd)}...`));

    const baseArgs = ["--cwd", cwd, "--region", opts.region];
    if (opts.version) baseArgs.push("--version", opts.version);

    // Dry-run preview
    const { data: preview, ok } = callScript([...baseArgs, "--dry-run"]);

    if (!ok || !preview) {
      console.error(chalk.red("❌ Error al analizar el repo."));
      process.exit(1);
    }

    if (!preview.ok) {
      console.error(chalk.red(`❌ ${preview.error}`));
      process.exit(1);
    }

    // Mostrar resumen
    console.log(chalk.bold.cyan(`\n📦 Release preview\n`));
    console.log(`  ${chalk.bold("Repo:")}     ${preview.repo}`);
    console.log(`  ${chalk.bold("Versión:")}  ${chalk.dim(preview.current_version)} → ${chalk.green(preview.new_version)}`);
    console.log(`  ${chalk.bold("Commits:")}  ${preview.commit_count}`);
    console.log(`  ${chalk.bold("HUs:")}      ${(preview.hu_list as string[]).join(", ") || "ninguna detectada"}`);
    console.log();
    console.log(chalk.bold("📋 Changelog:\n"));
    console.log(chalk.dim(preview.changelog));

    if (opts.dryRun) {
      console.log(chalk.yellow("\n[dry-run] Sin cambios.\n"));
      return;
    }

    const { confirm } = await inquirer.prompt([
      {
        type: "list",
        name: "confirm",
        message: `¿Crear release v${preview.new_version}? (bump pom.xml → push → PR master→release → Jira)`,
        choices: [
          { name: "✅ Sí, crear release", value: "yes" },
          { name: "❌ Cancelar",          value: "no"  },
        ],
      },
    ]);

    if (confirm !== "yes") {
      console.log(chalk.gray("\n🚫 Cancelado.\n"));
      return;
    }

    console.log(chalk.dim("\n  Ejecutando pipeline de release..."));

    const { data: result, ok: fullOk } = callScript(baseArgs);

    if (!fullOk || !result?.ok) {
      console.error(chalk.red("❌ Pipeline de release falló."));
      process.exit(1);
    }

    console.log(chalk.green(`\n✅ pom.xml actualizado a v${result.new_version}`));
    console.log(chalk.green(`✅ Push a origin/${result.repo}`));

    if (result.pr_url) {
      console.log(chalk.green(`✅ PR creado: ${chalk.cyan(result.pr_url)}`));
    } else {
      console.log(chalk.yellow("⚠️  PR no pudo crearse en CodeCommit (verificar AWS CLI)."));
    }

    if ((result.jira_updated as string[]).length > 0) {
      console.log(chalk.green(`✅ Jira actualizado: ${(result.jira_updated as string[]).join(", ")}`));
    }

    console.log();
  });

export default release;
