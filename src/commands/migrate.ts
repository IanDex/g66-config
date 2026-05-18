import { Command } from "commander";
import { spawnSync, execSync } from "child_process";
import inquirer from "inquirer";
import chalk from "chalk";
import * as path from "path";
import * as fs from "fs";

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "migrate_context.py");

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

const migrate = new Command("migrate")
  .description("🗄️  Genera changeSet Liquibase desde cambios en entidades JPA con Claude")
  .option("--region <region>", "AWS region", "us-east-1")
  .option("--hu <hu>",         "Código de HU explícito (ej: AT-108)")
  .option("--dry-run",         "Solo mostrar el XML sin escribir el archivo")
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

    console.log(chalk.dim(`\n  Analizando entidades JPA con Claude...\n`));

    // ── 2. Generar XML ────────────────────────────────────────────────────
    const baseArgs = ["--cwd", cwd, "--hu", hu];
    const { data: preview, ok } = callScript([...baseArgs, "--dry-run"]);

    if (!ok || !preview) {
      console.error(chalk.red("❌ Error al analizar las entidades."));
      process.exit(1);
    }
    if (!preview.ok) {
      console.error(chalk.red(`❌ ${preview.error}`));
      process.exit(1);
    }

    // ── 3. Mostrar preview ────────────────────────────────────────────────
    console.log(chalk.bold(`  Servicio: ${chalk.cyan(preview.service)}  |  HU: ${chalk.blue(hu)}`));
    console.log(chalk.dim(`  Entidades detectadas:`));
    for (const f of (preview.entity_files ?? [])) {
      console.log(chalk.dim(`    • ${f}`));
    }
    console.log(chalk.dim(`\n  Directorio: ${preview.migration_dir}`));
    console.log(chalk.dim(`  Archivo sugerido: ${chalk.bold(preview.filename)}\n`));
    console.log(chalk.bold("  YAML generado:\n"));
    console.log(chalk.dim("  ─".repeat(50)));
    console.log(preview.yaml);
    console.log(chalk.dim("  ─".repeat(50)));

    const t = preview.tokens;
    if (t) console.log(chalk.dim(`\n  🪙 Tokens: ${t.input_tokens} entrada + ${t.output_tokens} salida = ${chalk.bold(t.total_tokens)} total`));

    if (opts.dryRun) {
      console.log(chalk.yellow("\n  [dry-run] Sin cambios.\n"));
      return;
    }

    // ── 4. Confirmar nombre de archivo ────────────────────────────────────
    const { filename } = await inquirer.prompt([{
      type:    "input",
      name:    "filename",
      message: "Nombre del archivo XML:",
      default: preview.filename,
      validate: (v: string) => v.trim().endsWith(".yaml") || "Debe terminar en .yaml",
    }]);

    const { confirm } = await inquirer.prompt([{
      type:    "list",
      name:    "confirm",
      message: `¿Escribir ${filename} en ${path.basename(preview.migration_dir)}?`,
      choices: [
        { name: "✅ Sí, crear archivo", value: "yes" },
        { name: "❌ Cancelar",          value: "no"  },
      ],
    }]);
    if (confirm !== "yes") {
      console.log(chalk.gray("\n🚫 Cancelado.\n"));
      return;
    }

    // ── 5. Escribir archivo ───────────────────────────────────────────────
    const outPath = path.join(preview.migration_dir, filename);
    if (fs.existsSync(outPath)) {
      console.error(chalk.red(`❌ Ya existe ${outPath}. Elige otro nombre.`));
      process.exit(1);
    }
    fs.writeFileSync(outPath, preview.yaml, "utf-8");
    console.log(chalk.green(`\n  ✅ Archivo creado: ${outPath}\n`));
  });

export default migrate;
