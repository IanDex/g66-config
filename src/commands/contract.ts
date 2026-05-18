import { Command } from "commander";
import { spawnSync, execSync } from "child_process";
import inquirer from "inquirer";
import chalk from "chalk";
import * as path from "path";

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "contract_context.py");

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

const contract = new Command("contract")
  .description("📄 Genera contratos de endpoints modificados y los publica como comentario en la HU de Jira")
  .option("--region <region>", "AWS region", "us-east-1")
  .option("--hu <hu>",         "Código de HU explícito (ej: AT-106)")
  .option("--dry-run",         "Solo mostrar los contratos sin publicar en Jira")
  .option("--class <fqn>",     "Clase específica: com.pkg.ClassName o ClassName#method")
  .action(async (opts) => {
    const cwd = process.cwd();

    // ── 1. Inferir o preguntar HU ─────────────────────────────────────────
    let hu: string = opts.hu?.trim().toUpperCase() || inferHu() || "";
    if (!hu) {
      const ans = await inquirer.prompt([{
        type: "input",
        name: "hu",
        message: "¿Cuál es el código de la HU? (ej: AT-108)",
        validate: (v: string) => /^[A-Z]{2,6}-\d+$/i.test(v.trim()) || "Formato inválido (ej: AT-108)",
      }]);
      hu = ans.hu.trim().toUpperCase();
    }

    console.log(chalk.dim(`\n  Analizando endpoints en ${path.basename(cwd)} con Claude...\n`));

    // ── 2. Dry-run: generar contratos sin publicar ────────────────────────
    const baseArgs = ["--cwd", cwd, "--hu", hu, "--region", opts.region];
    if (opts.class) baseArgs.push("--class", opts.class);
    const { data: preview, ok } = callScript([...baseArgs, "--dry-run"]);

    if (!ok || !preview) {
      console.error(chalk.red("❌ Error al analizar los controladores."));
      process.exit(1);
    }
    if (!preview.ok) {
      console.error(chalk.red(`❌ ${preview.error}`));
      process.exit(1);
    }

    const endpoints: any[] = preview.endpoints ?? [];

    // ── 3. Mostrar preview ────────────────────────────────────────────────
    console.log(chalk.bold(`  Servicio: ${chalk.cyan(preview.service)}  |  HU: ${chalk.blue(hu)}`));
    console.log(chalk.dim(`  Endpoints detectados: ${endpoints.length}\n`));

    for (const ep of endpoints) {
      const method = (ep.method ?? "").toUpperCase();
      const color  = method === "GET" ? chalk.green : method === "DELETE" ? chalk.red : chalk.yellow;
      console.log(`  ${color(method.padEnd(7))} ${chalk.bold(ep.path)}`);
      console.log(chalk.dim(`           ${ep.description ?? ""}`));

      if (ep.headers?.length) {
        console.log(chalk.dim(`           Headers: ${ep.headers.map((h: any) => h.name).join(", ")}`));
      }
      const reqFields = ep.request_body?.fields?.length ?? 0;
      const resFields = ep.response_body?.fields?.length ?? 0;
      if (reqFields) console.log(chalk.dim(`           Request:  ${reqFields} campo(s)`));
      if (resFields) console.log(chalk.dim(`           Response: ${resFields} campo(s)`));
      console.log();
    }

    if (opts.dryRun) {
      const t = preview.tokens;
      if (t) console.log(chalk.dim(`  🪙 Tokens: ${t.input_tokens} entrada + ${t.output_tokens} salida = ${chalk.bold(t.total_tokens)} total`));
      console.log(chalk.yellow("\n  [dry-run] Contratos generados — no se publicó en Jira.\n"));
      return;
    }

    // ── 4. Confirmar publicación en Jira ──────────────────────────────────
    const { confirm } = await inquirer.prompt([{
      type: "list",
      name: "confirm",
      message: `¿Publicar ${endpoints.length} contrato(s) como comentario en ${hu}?`,
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
    console.log(chalk.dim("  Publicando en Jira...\n"));
    const { data: result, ok: fullOk } = callScript(baseArgs);

    if (!fullOk || !result?.ok) {
      console.error(chalk.red("❌ Error al publicar el contrato."));
      process.exit(1);
    }

    if (result.jira_posted) {
      console.log(chalk.green(`  ✅ Comentario publicado en ${hu}`));
    } else {
      console.log(chalk.yellow("  ⚠ Contratos generados pero no se pudo publicar en Jira (verificar credenciales)."));
    }

    const tokens = result.tokens;
    if (tokens) {
      console.log(chalk.dim(`\n  🪙 Tokens usados: ${tokens.input_tokens} entrada + ${tokens.output_tokens} salida = ${chalk.bold(tokens.total_tokens)} total\n`));
    }
  });

export default contract;
