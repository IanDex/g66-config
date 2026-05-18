import { Command } from "commander";
import { spawnSync, execSync } from "child_process";
import inquirer from "inquirer";
import chalk from "chalk";
import * as path from "path";

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "summary_context.py");

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

function inferHu(): string | null {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
    const parts  = branch.split("/");
    return parts.length >= 3 ? parts[parts.length - 1].toUpperCase() : null;
  } catch {
    return null;
  }
}

const summary = new Command("summary")
  .description("📝 Genera resumen ejecutivo de la HU y lo publica como comentario en Jira")
  .option("--region <region>", "AWS region", "us-east-1")
  .option("--hu <hu>",         "Código de HU explícito (ej: AT-108)")
  .option("--dry-run",         "Solo mostrar el resumen sin publicar en Jira")
  .action(async (opts) => {
    const cwd = process.cwd();

    // ── 1. HU ─────────────────────────────────────────────────────────────
    let hu: string = opts.hu?.trim().toUpperCase() || inferHu() || "";
    if (!hu) {
      const ans = await inquirer.prompt([{
        type: "input",
        name: "hu",
        message: "¿Código de la HU? (ej: AT-108)",
        validate: (v: string) => /^[A-Z]{2,6}-\d+$/i.test(v.trim()) || "Formato inválido",
      }]);
      hu = ans.hu.trim().toUpperCase();
    }

    console.log(chalk.dim(`\n  Generando resumen de ${hu} con Claude...\n`));

    // ── 2. Generar resumen ────────────────────────────────────────────────
    const baseArgs = ["--cwd", cwd, "--hu", hu];
    const { data: preview, ok } = callScript([...baseArgs, "--dry-run"]);

    if (!ok || !preview) {
      console.error(chalk.red("❌ Error al generar el resumen."));
      process.exit(1);
    }
    if (!preview.ok) {
      console.error(chalk.red(`❌ ${preview.error}`));
      process.exit(1);
    }

    // ── 3. Mostrar preview ────────────────────────────────────────────────
    console.log(chalk.bold(`  Servicio: ${chalk.cyan(preview.service)}  |  HU: ${chalk.blue(hu)}`));
    console.log(chalk.dim(`  Commits: ${preview.commits}  |  Archivos: ${preview.files}\n`));
    console.log(chalk.bold("  Resumen generado:\n"));
    console.log(chalk.dim("  ─".repeat(60)));
    console.log(preview.summary);
    console.log(chalk.dim("  ─".repeat(60)));

    const t = preview.tokens;
    if (t) console.log(chalk.dim(`\n  🪙 Tokens: ${t.input_tokens} entrada + ${t.output_tokens} salida = ${chalk.bold(t.total_tokens)} total`));

    if (opts.dryRun) {
      console.log(chalk.yellow("\n  [dry-run] Sin cambios en Jira.\n"));
      return;
    }

    // ── 4. Confirmar ──────────────────────────────────────────────────────
    const { confirm } = await inquirer.prompt([{
      type:    "list",
      name:    "confirm",
      message: `¿Publicar este resumen como comentario en ${hu}?`,
      choices: [
        { name: "✅ Sí, publicar en Jira", value: "yes" },
        { name: "❌ Cancelar",             value: "no"  },
      ],
    }]);
    if (confirm !== "yes") {
      console.log(chalk.gray("\n🚫 Cancelado.\n"));
      return;
    }

    // ── 5. Publicar ───────────────────────────────────────────────────────
    console.log(chalk.dim("\n  Publicando en Jira...\n"));
    const { data: result, ok: fullOk } = callScript(baseArgs);

    if (!fullOk || !result?.ok) {
      console.error(chalk.red("❌ Error al publicar el resumen."));
      process.exit(1);
    }

    if (result.posted) {
      console.log(chalk.green(`  ✅ Resumen publicado en ${hu}\n`));
    } else {
      console.log(chalk.yellow("  ⚠ Resumen generado pero no se pudo publicar en Jira.\n"));
    }
  });

export default summary;
