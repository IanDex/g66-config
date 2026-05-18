import { Command } from "commander";
import { execSync, spawnSync } from "child_process";
import inquirer from "inquirer";
import chalk from "chalk";
import * as path from "path";

const SYNC_ALL = path.join(__dirname, "..", "..", "vendor", "apigw", "scripts", "sync_all_envs.ps1");
const SYNC_ONE = path.join(__dirname, "..", "..", "vendor", "apigw", "scripts", "sync_from_aws.ps1");

function git(args: string): string {
  try {
    return execSync(`git ${args}`, { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function getRepoPath(): string {
  return git("rev-parse --show-toplevel").replace(/\//g, "\\");
}

function getBranch(): string {
  return git("rev-parse --abbrev-ref HEAD");
}

function inferHu(branch: string): string | null {
  // user/env/HU — toma todo lo que viene después del segundo /
  const parts = branch.split("/");
  if (parts.length >= 3) return parts.slice(2).join("/").toUpperCase();
  return null;
}

function inferEnvsFromBranch(branch: string): string {
  const parts = branch.split("/");
  const env = parts[1]?.toLowerCase();
  if (env === "ci")   return "ci";
  if (env === "prod") return "prod";
  return "dev";
}

function runPs1(script: string, args: Record<string, string>): void {
  const argStr = Object.entries(args)
    .map(([k, v]) => `-${k} "${v}"`)
    .join(" ");
  const cmd = `pwsh -ExecutionPolicy Bypass -NoProfile -File "${script}" ${argStr}`;
  console.log(chalk.dim(`\n→ ${cmd}\n`));
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch {
    process.exit(1);
  }
}

const apigw = new Command("apigw")
  .description("🔀 Sincroniza rutas de API Gateway desde el diff del MS actual")
  .option("--hu <code>",   "Código HU (ej: AT-108) — se infiere de la rama si no se pasa")
  .option("--envs <envs>", "Entornos a sincronizar: dev,ci,prod (default: todos)")
  .option("--only <env>",  "Un solo entorno (dev | ci | prod)")
  .action(async (opts) => {
    const branch  = getBranch();
    const repo    = getRepoPath();

    if (!repo) {
      console.error(chalk.red("❌ No estás dentro de un repositorio git."));
      process.exit(1);
    }

    // HU
    const inferredHu = inferHu(branch);
    let hu = opts.hu ?? inferredHu;

    if (!hu) {
      const ans = await inquirer.prompt([{
        type: "input",
        name: "hu",
        message: "🔖 Código HU (ej: AT-108):",
        validate: (v) => !!v.trim() || "Requerido",
      }]);
      hu = ans.hu.trim().toUpperCase();
    }

    // Envs — inferir de la rama; solo preguntar si la rama no tiene formato user/env/HU
    const inferredEnv = inferEnvsFromBranch(branch);
    let envs = opts.envs ?? (opts.only ? opts.only : null);

    if (!envs) {
      const branchHasEnv = branch.split("/").length >= 3;
      if (branchHasEnv) {
        envs = inferredEnv;
      } else {
        const { selected } = await inquirer.prompt([{
          type: "checkbox",
          name: "selected",
          message: "🌐 Entornos a sincronizar:",
          choices: [
            { name: "dev  → development", value: "dev",  checked: inferredEnv === "dev" },
            { name: "ci   → master",      value: "ci",   checked: inferredEnv === "ci" },
            { name: "prod → release",     value: "prod", checked: inferredEnv === "prod" },
          ],
        }]);
        if (!selected.length) {
          console.log(chalk.yellow("Sin entornos seleccionados."));
          return;
        }
        envs = selected.join(",");
      }
    }

    console.log(chalk.blue(`\n📦 Repo: ${repo}`));
    console.log(chalk.blue(`🔖 HU:   ${hu}`));
    console.log(chalk.blue(`🌐 Envs: ${envs}\n`));

    if (opts.only) {
      runPs1(SYNC_ONE, { Repo: repo, Env: opts.only, Hu: hu, PrepareConfig: "" });
    } else {
      runPs1(SYNC_ALL, { Repo: repo, Hu: hu, Envs: envs });
    }
  });

export default apigw;
