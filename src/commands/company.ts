import { Command } from "commander";
import { execSync, spawnSync } from "child_process";
import inquirer from "inquirer";
import chalk from "chalk";
import * as path from "path";

const LOGI = path.join(__dirname, "..", "..", "logi", "cli.py");

function pyJson<T>(args: string[]): T {
  const result = spawnSync("python", [LOGI, ...args], { encoding: "utf-8" });
  if (result.status !== 0) throw new Error(result.stderr || "Error en CLI logi");
  return JSON.parse(result.stdout.trim()) as T;
}

async function askEnv(): Promise<string> {
  const { env } = await inquirer.prompt([
    { type: "list", name: "env", message: "🌐 Entorno:", choices: ["dev", "ci"], default: "dev" },
  ]);
  return env;
}

const company = new Command("company")
  .description("🏢 Vista completa de una compañía y sus usuarios")
  .option("-e, --env <env>", "Entorno: dev | ci")
  .option("--id <id>", "ID de la compañía")
  .option("--login", "Hacer login con un usuario de la compañía")
  .option("--no-copy", "No copiar idToken al clipboard (requiere --login)")
  .option("--decode", "Mostrar JWT claims (requiere --login)")
  .action(async (opts) => {
    const env = opts.env ?? (await askEnv());

    let companyId = opts.id;
    if (!companyId) {
      const { id } = await inquirer.prompt([
        { type: "input", name: "id", message: "🏢 ID de compañía:", validate: (v) => !!v.trim() || "Requerido" },
      ]);
      companyId = id.trim();
    }

    // Mostrar info de la empresa
    const cmd = `python "${LOGI}" company --env ${env} --id ${companyId}`;
    console.log(chalk.dim(`\n→ ${cmd}\n`));
    try {
      execSync(cmd, { stdio: "inherit" });
    } catch {
      process.exit(1);
    }

    if (!opts.login) return;

    // Seleccionar usuario y hacer login
    const userList = pyJson<{ email: string; is_legal_representative: boolean }[]>([
      "users", "--env", env, "--company-id", String(companyId), "--json",
    ]);

    if (!userList.length) {
      console.log(chalk.yellow("Sin usuarios activos."));
      return;
    }

    let email: string;
    if (userList.length === 1) {
      email = userList[0].email;
      console.log(chalk.dim(`\n  Usuario: ${email}`));
    } else {
      const ans = await inquirer.prompt([
        {
          type: "list",
          name: "email",
          message: "👤 Usuario para login:",
          choices: userList.map((u) => ({
            name: `${u.email}${u.is_legal_representative ? "  ★ rep legal" : ""}`,
            value: u.email,
          })),
        },
      ]);
      email = ans.email;
    }

    const tokenArgs = ["--env", env, "--email", email];
    if (opts.decode) tokenArgs.push("--decode");
    const tokenCmd = `python "${LOGI}" token ${tokenArgs.join(" ")}`;
    console.log(chalk.dim(`\n→ ${tokenCmd}\n`));
    try {
      execSync(tokenCmd, { stdio: "inherit" });
    } catch {
      process.exit(1);
    }
  });

export default company;
