import { Command } from "commander";
import { spawnSync, execSync } from "child_process";
import inquirer from "inquirer";
import chalk from "chalk";
import * as path from "path";

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "hotfix_context.py");

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
  { name: "Todos  (release + master + development)", value: "prod,ci,dev" },
  { name: "PROD + CI  (release + master)",           value: "prod,ci"     },
  { name: "Solo PROD  (release)",                    value: "prod"        },
];

const hotfix = new Command("hotfix")
  .description("🚨 Cherry-pick commits a release/master/development y crea PRs de hotfix")
  .option("--region <region>", "AWS region", "us-east-1")
  .option("--hu <hu>",         "Código de HU o ticket (ej: AT-108)")
  .action(async (opts) => {
    const cwd = process.cwd();

    // ── 1. HU ─────────────────────────────────────────────────────────────
    let hu: string = opts.hu?.trim().toUpperCase() || inferHu() || "";
    if (!hu) {
      const ans = await inquirer.prompt([{
        type: "input",
        name: "hu",
        message: "¿Código del ticket a hotfix? (ej: AT-108)",
        validate: (v: string) => /^[A-Z]{2,6}-\d+$/i.test(v.trim()) || "Formato inválido",
      }]);
      hu = ans.hu.trim().toUpperCase();
    }

    // ── 2. Cargar commits recientes ───────────────────────────────────────
    console.log(chalk.dim("\n  Cargando commits recientes...\n"));
    const { data: listData, ok: listOk } = callScript(["--cwd", cwd, "--list"]);
    if (!listOk || !listData?.ok) {
      console.error(chalk.red("❌ No se pudieron obtener los commits."));
      process.exit(1);
    }

    const commits: any[] = listData.commits ?? [];
    if (!commits.length) {
      console.error(chalk.red("❌ No hay commits recientes."));
      process.exit(1);
    }

    // ── 3. Seleccionar commits ────────────────────────────────────────────
    const { selectedShas } = await inquirer.prompt([{
      type:    "checkbox",
      name:    "selectedShas",
      message: "¿Qué commits aplicar al hotfix? (espacio = marcar)",
      choices: commits.map(c => ({
        name:  `${chalk.yellow(c.sha.slice(0, 7))}  ${c.message.slice(0, 65).padEnd(65)}  ${chalk.dim(c.date)}`,
        value: c.sha,
      })),
      validate: (v: string[]) => v.length > 0 || "Selecciona al menos un commit",
    }]);

    // ── 4. Seleccionar ambientes ──────────────────────────────────────────
    const { envSelection } = await inquirer.prompt([{
      type:    "list",
      name:    "envSelection",
      message: "¿A qué ambientes aplicar el hotfix?",
      choices: ENV_CHOICES,
    }]);

    // ── 5. Confirmar ──────────────────────────────────────────────────────
    const shaList = (selectedShas as string[]).map((s: string) => s.slice(0, 7)).join(", ");
    console.log(chalk.dim(`\n  Commits: ${shaList}`));
    const { confirm } = await inquirer.prompt([{
      type:    "list",
      name:    "confirm",
      message: `¿Crear ramas hotfix + PRs para ${(envSelection as string).toUpperCase().replace(/,/g, " + ")}?`,
      choices: [
        { name: "✅ Sí, crear hotfix", value: "yes" },
        { name: "❌ Cancelar",          value: "no"  },
      ],
    }]);
    if (confirm !== "yes") {
      console.log(chalk.gray("\n🚫 Cancelado.\n"));
      return;
    }

    // ── 6. Ejecutar ───────────────────────────────────────────────────────
    console.log(chalk.dim("\n  Creando ramas y PRs...\n"));
    const { data: result, ok: fullOk } = callScript([
      "--cwd", cwd,
      "--hu", hu,
      "--envs", envSelection,
      "--commits", (selectedShas as string[]).join(","),
      "--region", opts.region,
    ]);

    if (!fullOk || !result?.ok) {
      console.error(chalk.red("❌ Error al crear el hotfix."));
      process.exit(1);
    }

    for (const [env, info] of Object.entries(result.results ?? {})) {
      const err    = (info as any).error;
      const prUrl  = (info as any).pr_url;
      const branch = (info as any).branch;
      const tag    = env.toUpperCase().padEnd(5);
      if (err) {
        console.log(chalk.red(`  ✗ ${tag} ${err}`));
      } else {
        console.log(chalk.green(`  ✅ ${tag} ${chalk.cyan(branch)}`));
        if (prUrl) console.log(chalk.dim(`       PR: ${prUrl}`));
        else       console.log(chalk.yellow(`       ⚠ PR no pudo crearse`));
      }
    }
    console.log();
  });

export default hotfix;
