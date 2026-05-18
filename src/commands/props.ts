import { Command } from "commander";
import { spawnSync, execSync } from "child_process";
import inquirer from "inquirer";
import chalk from "chalk";
import * as path from "path";

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "props_sync.py");

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

const ENV_CHOICES = [
  { name: "Todos  (dev + ci + prod)", value: "dev,ci,prod" },
  { name: "Dev y CI",                 value: "dev,ci"      },
  { name: "Solo DEV",                 value: "dev"          },
  { name: "Solo CI",                  value: "ci"           },
  { name: "Solo PROD",                value: "prod"         },
];

const props = new Command("props")
  .description("🔧 Detecta @Value properties faltantes y crea PRs en ms-config-properties (dev/ci/prod)")
  .option("--region <region>", "AWS region", "us-east-1")
  .option("--dry-run",         "Solo mostrar qué falta sin modificar nada")
  .action(async (opts) => {
    const cwd = process.cwd();

    // ── 1. Inferir o preguntar HU ──────────────────────────────────────────
    let hu = inferHu();
    if (!hu) {
      const ans = await inquirer.prompt([{
        type: "input",
        name: "hu",
        message: "¿Cuál es el código de la HU? (ej: AT-108)",
        validate: (v: string) => /^[A-Z]{2,6}-\d+$/i.test(v.trim()) || "Formato inválido (ej: AT-108)",
      }]);
      hu = ans.hu.trim().toUpperCase();
    }

    console.log(chalk.dim(`\n  Escaneando @Value properties en archivos modificados de ${path.basename(cwd)}...`));

    // ── 2. Preview con todos los envs para detectar qué falta ─────────────
    const baseArgs = ["--cwd", cwd, "--hu", hu, "--envs", "dev,ci,prod", "--region", opts.region];
    const { data: preview, ok } = callScript([...baseArgs, "--dry-run"]);

    if (!ok || !preview) {
      console.error(chalk.red("❌ Error al analizar el proyecto."));
      process.exit(1);
    }
    if (!preview.ok) {
      console.error(chalk.red(`❌ ${preview.error}`));
      process.exit(1);
    }

    // ── 3. Mostrar resultados del scan ────────────────────────────────────
    console.log(chalk.bold(`\n  Servicio: ${chalk.cyan(preview.service)}  |  HU: ${chalk.blue(hu)}`));
    console.log(chalk.dim(`  Archivos escaneados (committed + staged + unstaged + untracked):`));
    for (const f of (preview.scanned_files ?? []).slice(0, 10)) {
      console.log(chalk.dim(`    • ${f}`));
    }
    console.log(chalk.dim(`  @Value encontradas: ${preview.total_code_props}`));
    console.log();

    const results: Record<string, any> = preview.results ?? {};
    let totalMissing = 0;

    // Recopilar properties sin default de TODOS los envs (deduplicado)
    const noDefaultKeys = new Set<string>();

    for (const [env, info] of Object.entries(results)) {
      const added:    string[]           = (info as any).added ?? [];
      const details:  { key: string; default: string | null }[] = (info as any).details ?? [];
      const envError: string | undefined = (info as any).error;
      const tag = env.toUpperCase().padEnd(5);

      if (envError) {
        console.log(chalk.red(`  ✗ ${tag} ${envError}`));
      } else if (added.length === 0) {
        console.log(chalk.green(`  ✓ ${tag} todas las properties existen`));
      } else {
        totalMissing += added.length;
        console.log(chalk.yellow(`  ⚠ ${tag} ${added.length} faltantes:`));
        for (const key of added) {
          console.log(chalk.dim(`        • ${key}`));
        }
        for (const d of details) {
          if (d.default === null || d.default === undefined || d.default === "") {
            noDefaultKeys.add(d.key);
          }
        }
      }
    }

    console.log();

    if (totalMissing === 0) {
      console.log(chalk.green.bold("  ✅ ms-config-properties completo — no falta nada.\n"));
      return;
    }

    if (opts.dryRun) {
      console.log(chalk.yellow(`  [dry-run] ${totalMissing} properties serían agregadas.\n`));
      return;
    }

    // ── 4. Pedir valores para properties sin default ──────────────────────
    const explicitValues: Record<string, string> = {};

    if (noDefaultKeys.size > 0) {
      console.log(chalk.yellow(`\n  Las siguientes properties no tienen valor por defecto.\n  Debes proveer un valor para continuar:\n`));
      for (const key of noDefaultKeys) {
        const { val } = await inquirer.prompt([{
          type: "input",
          name: "val",
          message: `  ${chalk.cyan(key)} =`,
          validate: (v: string) => v.trim().length > 0 || "El valor no puede estar vacío",
        }]);
        explicitValues[key] = val.trim();
      }
      console.log();
    }

    // ── 5. Selección de environments (solo si hay algo que agregar) ────────
    const { envSelection } = await inquirer.prompt([{
      type: "list",
      name: "envSelection",
      message: `¿Para qué environments crear PRs en ms-config-properties?`,
      choices: ENV_CHOICES,
    }]);

    // ── 6. Confirmar ──────────────────────────────────────────────────────
    const { confirm } = await inquirer.prompt([{
      type: "list",
      name: "confirm",
      message: `¿Crear branch + commit + PR para ${(envSelection as string).toUpperCase().replace(/,/g, " + ")}?`,
      choices: [
        { name: "✅ Sí, crear PRs", value: "yes" },
        { name: "❌ Cancelar",      value: "no"  },
      ],
    }]);

    if (confirm !== "yes") {
      console.log(chalk.gray("\n🚫 Cancelado.\n"));
      return;
    }

    // ── 7. Ejecutar ───────────────────────────────────────────────────────
    console.log(chalk.dim("  Aplicando cambios y creando PRs...\n"));
    const finalArgs = ["--cwd", cwd, "--hu", hu, "--envs", envSelection, "--region", opts.region];
    if (Object.keys(explicitValues).length > 0) {
      finalArgs.push("--values", JSON.stringify(explicitValues));
    }
    const { data: result, ok: fullOk } = callScript(finalArgs);

    if (!fullOk || !result?.ok) {
      console.error(chalk.red("❌ Error al aplicar los cambios."));
      process.exit(1);
    }

    for (const [env, info] of Object.entries(result.results ?? {})) {
      const added:    string[]           = (info as any).added ?? [];
      const envError: string | undefined = (info as any).error;
      const tag = env.toUpperCase().padEnd(5);

      if (envError) {
        console.log(chalk.red(`  ✗ ${tag} ${envError}`));
      } else if (added.length > 0) {
        const prUrl: string | null = (info as any).pr_url ?? null;
        console.log(chalk.green(`  ✅ ${tag} ${added.length} properties agregadas`));
        if (prUrl) {
          console.log(chalk.cyan(`     PR: ${prUrl}`));
        } else {
          console.log(chalk.yellow(`     ⚠ PR no pudo crearse (verificar AWS CLI)`));
        }
      }
    }

    console.log();
  });

export default props;
