import { Command } from "commander";
import { execSync } from "child_process";
import inquirer from "inquirer";
import chalk from "chalk";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const G66_CONFIG = path.join(os.homedir(), ".g66-config.json");

function getOrSavePrefix(): string {
  let cfg: any = {};
  try { cfg = JSON.parse(fs.readFileSync(G66_CONFIG, "utf-8")); } catch { /* ignorar */ }
  if (cfg.branch_prefix) return cfg.branch_prefix;
  return "";
}

function savePrefix(prefix: string): void {
  let cfg: any = {};
  try { cfg = JSON.parse(fs.readFileSync(G66_CONFIG, "utf-8")); } catch { /* ignorar */ }
  cfg.branch_prefix = prefix;
  fs.writeFileSync(G66_CONFIG, JSON.stringify(cfg, null, 2), "utf-8");
}

const ENV_BRANCH: Record<string, string> = {
  dev:  "development",
  ci:   "master",
  prod: "release",
};

const nb = new Command("nb")
  .description("🌿 Crear nueva rama cv/{env}/{hu} y hacer checkout")
  .argument("<env>", "Ambiente: dev | ci | prod")
  .argument("<hu>",  "Código de HU (ej: AT-110)")
  .action(async (env: string, hu: string) => {
    const base = ENV_BRANCH[env.toLowerCase()];
    if (!base) {
      console.error(chalk.red(`❌ Ambiente desconocido: '${env}'. Usar: dev | ci | prod`));
      process.exit(1);
    }

    let prefix = getOrSavePrefix();
    if (!prefix) {
      const ans = await inquirer.prompt([{
        type: "input", name: "prefix",
        message: "¿Cuál es tu prefijo de rama? (ej: cv, juan, jl):",
        validate: (v: string) => v.trim().length > 0 || "No puede estar vacío",
      }]);
      prefix = ans.prefix.trim().toLowerCase();
      savePrefix(prefix);
      console.log(chalk.green(`  ✅ Guardado en ~/.g66-config.json\n`));
    }

    const branch = `${prefix}/${env.toLowerCase()}/${hu.toUpperCase()}`;

    try {
      console.log(chalk.dim(`\n  → git checkout ${base} && git pull && git checkout -b ${branch}\n`));
      execSync(`git checkout ${base}`, { stdio: "inherit" });
      execSync(`git pull`,             { stdio: "inherit" });
      execSync(`git checkout -b ${branch}`, { stdio: "inherit" });
      console.log(chalk.green(`\n  ✅ Rama creada: ${chalk.bold(branch)}\n`));
    } catch {
      process.exit(1);
    }
  });

export default nb;
