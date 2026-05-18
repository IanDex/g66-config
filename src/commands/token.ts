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

function runToken(args: string[]) {
  const cmd = `python "${LOGI}" token ${args.join(" ")}`;
  console.log(chalk.dim(`\n→ ${cmd}\n`));
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch {
    process.exit(1);
  }
}

function runFindUser(args: string[]) {
  const cmd = `python "${LOGI}" find-user ${args.join(" ")}`;
  console.log(chalk.dim(`\n→ ${cmd}\n`));
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch {
    process.exit(1);
  }
}

async function askEnv(): Promise<string> {
  const { env } = await inquirer.prompt([
    { type: "list", name: "env", message: "🌐 Entorno:", choices: ["dev", "ci"], default: "dev" },
  ]);
  return env;
}

async function pickUser(env: string, companyId: number): Promise<string> {
  console.log(chalk.dim("  Cargando usuarios..."));
  const userList = pyJson<{ email: string; is_legal_representative: boolean }[]>([
    "users", "--env", env, "--company-id", String(companyId), "--json",
  ]);
  if (!userList.length) {
    console.log(chalk.yellow("Sin usuarios activos en esa compañía."));
    process.exit(0);
  }
  if (userList.length === 1) {
    console.log(chalk.dim(`  Usuario: ${userList[0].email}`));
    return userList[0].email;
  }
  const { email } = await inquirer.prompt([
    {
      type: "list",
      name: "email",
      message: "👤 Usuario:",
      choices: userList.map((u) => ({
        name: `${u.email}${u.is_legal_representative ? "  ★ rep legal" : ""}`,
        value: u.email,
      })),
    },
  ]);
  return email;
}

const KYC_STAGES = ["APPROVED", "UPLOADED_MANUAL", "UPLOADED_PARTNER", "REQUESTED_MANUAL", "REQUESTED_EMAIL", "REQUESTED_PARTNER"];

async function interactiveToken(extraFlags: string[]) {
  const env = await askEnv();

  const { kycStage } = await inquirer.prompt([
    { type: "list", name: "kycStage", message: "🔎 Estado KYC:", choices: KYC_STAGES, default: "APPROVED" },
  ]);

  console.log(chalk.dim("  Cargando países..."));
  const countries = pyJson<string[]>(["countries", "--env", env, "--json"]);

  const { country } = await inquirer.prompt([
    { type: "list", name: "country", message: "🌎 País:", choices: ["(todos)", ...countries] },
  ]);
  const countryFilter = country === "(todos)" ? null : country;

  console.log(chalk.dim("  Cargando compañías..."));
  const companyArgs = ["companies", "--env", env, "--status", kycStage, "--json"];
  if (countryFilter) companyArgs.push("--country", countryFilter);
  const companyList = pyJson<{ company_id: number; name: string; country: string; compliance_status: string }[]>(companyArgs);

  if (!companyList.length) {
    console.log(chalk.yellow("Sin compañías para ese filtro."));
    process.exit(0);
  }

  const { companyId } = await inquirer.prompt([
    {
      type: "list",
      name: "companyId",
      message: "🏢 Compañía:",
      choices: companyList.map((c) => ({
        name: `${c.name}  [${c.country || "?"}]  id=${c.company_id}  ${c.compliance_status || ""}`,
        value: c.company_id,
      })),
      pageSize: 15,
    },
  ]);

  const email = await pickUser(env, companyId);
  runToken(["--env", env, "--email", email, "--status", kycStage, ...extraFlags]);
}

const token = new Command("token")
  .description("🔑 Obtiene idToken B2B directo desde Cognito")
  .option("-e, --env <env>", "Entorno: dev | ci")
  .option("-c, --country <country>", "Filtro de país (ej: CO, CL, MX)")
  .option("--company-id <id>", "ID de compañía")
  .option("--email <email>", "Email directo")
  .option("-p, --password <password>", "Password (default: Global66)")
  .option("-s, --status <status>", "kyc_stage_1 filter (default: APPROVED)")
  .option("--find <email>", "Busca usuario por email y hace login")
  .option("--no-copy", "No copiar idToken al clipboard")
  .option("--decode", "Mostrar JWT claims decodificados")
  .action(async (opts) => {
    const extraFlags: string[] = [];
    if (opts.decode) extraFlags.push("--decode");

    // --find: busca por email y hace login
    if (opts.find) {
      const env = opts.env ?? (await askEnv());
      runFindUser(["--env", env, "--email", opts.find, "--login", ...extraFlags]);
      return;
    }

    // Solo company-id → preguntar env si falta, seleccionar usuario
    if (opts.companyId && !opts.country && !opts.email) {
      const env = opts.env ?? (await askEnv());
      const email = await pickUser(env, Number(opts.companyId));
      runToken(["--env", env, "--email", email, ...extraFlags]);
      return;
    }

    // Sin args → interactivo completo
    if (!opts.env && !opts.country && !opts.companyId && !opts.email && !opts.find) {
      await interactiveToken(extraFlags);
      return;
    }

    // Args explícitos → directo a Python
    const args: string[] = [];
    if (opts.env)       args.push("--env",        opts.env);
    if (opts.country)   args.push("--country",    opts.country);
    if (opts.companyId) args.push("--company-id", opts.companyId);
    if (opts.email)     args.push("--email",      opts.email);
    if (opts.password)  args.push("--password",   opts.password);
    if (opts.status)    args.push("--status",     opts.status);
    runToken([...args, ...extraFlags]);
  });

export default token;
