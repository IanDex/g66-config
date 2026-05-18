import { Command } from "commander";
import { execSync } from "child_process";
import inquirer from "inquirer";
import chalk from "chalk";
import * as path from "path";

const LOGI = path.join(__dirname, "..", "..", "logi", "cli.py");

const status = new Command("status")
  .description("📋 Pipeline completo de onboarding de un usuario y su empresa")
  .option("-e, --env <env>", "Entorno: dev | ci")
  .option("--email <email>", "Email del usuario")
  .action(async (opts) => {
    const env = opts.env ?? (await inquirer.prompt([
      { type: "list", name: "env", message: "🌐 Entorno:", choices: ["dev", "ci"], default: "dev" },
    ])).env;

    const email = opts.email ?? (await inquirer.prompt([
      { type: "input", name: "email", message: "📧 Email del usuario:", validate: (v) => !!v.trim() || "Requerido" },
    ])).email;

    const cmd = `python "${LOGI}" status --env ${env} --email "${email}"`;
    console.log(chalk.dim(`\n→ ${cmd}\n`));
    try {
      execSync(cmd, { stdio: "inherit" });
    } catch {
      process.exit(1);
    }
  });

export default status;
