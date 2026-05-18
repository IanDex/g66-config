import { Command } from "commander";
import { spawnSync, execSync } from "child_process";
import inquirer from "inquirer";
import chalk from "chalk";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { getCurrentBranch } from "../utils/git-utils";

const SCRIPT        = path.join(__dirname, "..", "..", "scripts", "pr_ai.py");
const SLACK_SCRIPT  = path.join(__dirname, "..", "..", "scripts", "slack_context.py");
const SYNC_ALL      = path.join(__dirname, "..", "..", "vendor", "apigw", "scripts", "sync_all_envs.ps1");
const MEMBERS_CACHE = path.join(os.homedir(), ".g66-slack-members.json");

function callScript(extraArgs: string[] = []): { data: any; ok: boolean } {
  const result = spawnSync("python", [SCRIPT, ...extraArgs], {
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

function runApigw(repo: string, hu: string, env: string): void {
  const argStr = `-Repo "${repo}" -Hu "${hu}" -Envs "${env}"`;
  const cmd = `pwsh -ExecutionPolicy Bypass -NoProfile -File "${SYNC_ALL}" ${argStr}`;
  console.log(chalk.dim(`\n→ ${cmd}\n`));
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch {
    console.error(chalk.red("❌ apigw sync falló — revisá el error arriba."));
  }
}

function getRepoPath(): string {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim().replace(/\//g, "\\");
  } catch {
    return process.cwd();
  }
}

const prSmart = new Command("pr-smart")
  .description("🤖 Push + PR en CodeCommit con título y descripción generados por IA")
  .option("--dry-run", "Solo muestra el PR generado sin commitear ni crear")
  .option("--mock",    "Simula el PR (sin commit/push/PR real) para testear flujos post-PR")
  .option("--region <region>", "AWS region", "us-east-1")
  .option("--apigw", "Sincronizar API Gateway automáticamente sin preguntar")
  .option("--no-apigw-prompt", "Omitir pregunta de API Gateway al final")
  .action(async (opts) => {
    let branch: string;
    try {
      branch = getCurrentBranch();
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }

    const match = branch.match(/[^/]+\/([^/]+)\/(.+)/);
    const hu  = match ? match[2].toUpperCase() : null;
    const env = match ? match[1].toLowerCase()  : "dev";

    if (!hu) {
      console.error(chalk.red(`\n🚫 Rama '${branch}' no sigue el formato user/env/HU.\n`));
      process.exit(1);
    }

    console.log(chalk.blue(`\n🌿 Rama: ${branch}`));
    console.log(chalk.blue(`🔖 HU:   ${hu}\n`));

    // Preview
    console.log(chalk.dim("  Analizando diff con Claude..."));
    const { data: preview, ok } = callScript(["--dry-run", "--region", opts.region]);

    if (!ok || !preview) {
      console.error(chalk.red("❌ Error al generar el PR."));
      process.exit(1);
    }

    console.log(chalk.bold.cyan("\n📋 PR generado:\n"));
    console.log(chalk.bold("Título:"));
    console.log(`  ${preview.title}\n`);
    console.log(chalk.bold("Descripción:"));
    console.log(chalk.dim(preview.description));

    if (opts.dryRun) {
      console.log(chalk.yellow("\n[dry-run] Sin cambios.\n"));
      return;
    }

    const { confirm } = await inquirer.prompt([
      {
        type: "list",
        name: "confirm",
        message: "¿Continuar? (git add → spotless → commit → push → PR → Jira)",
        choices: [
          { name: "✅ Sí", value: "yes" },
          { name: "❌ Cancelar", value: "no" },
        ],
      },
    ]);

    if (confirm !== "yes") {
      console.log(chalk.gray("\n🚫 Cancelado.\n"));
      return;
    }

    // Pipeline completo (o mock)
    let result: any;
    if (opts.mock) {
      result = {
        is_new:  true,
        pr_id:   "999",
        pr_url:  `https://us-east-1.console.aws.amazon.com/codesuite/codecommit/repositories/ms-business-api/pull-requests/999/details`,
        tokens:  null,
      };
      console.log(chalk.yellow("\n  [mock] Saltando commit/push/PR real.\n"));
    } else {
      const { data, ok: fullOk } = callScript(["--region", opts.region]);
      if (!fullOk || !data) {
        console.error(chalk.red("❌ Pipeline falló."));
        process.exit(1);
      }
      result = data;
    }

    const action = result.is_new ? "creado" : "actualizado";
    console.log(chalk.green(`\n✅ PR #${result.pr_id} ${action}!`));
    console.log(chalk.cyan(`🔗 ${result.pr_url}`));
    const t = result.tokens;
    if (t) console.log(chalk.dim(`  🪙 Tokens: ${t.input_tokens} entrada + ${t.output_tokens} salida = ${t.total_tokens} total\n`));

    // ── API Gateway sync ──────────────────────────────────────────────────
    if (opts.noApigwPrompt) return;

    let syncApigw = opts.apigw;
    if (!syncApigw) {
      const { apigwConfirm } = await inquirer.prompt([
        {
          type: "list",
          name: "apigwConfirm",
          message: "🔀 ¿Sincronizar API Gateway?",
          choices: [
            { name: "✅ Sí", value: true  },
            { name: "❌ No", value: false },
          ],
        },
      ]);
      syncApigw = apigwConfirm;
    }

    if (syncApigw) {
      const repo = getRepoPath();
      runApigw(repo, hu, env);
    }

    // ── Slack tablero ─────────────────────────────────────────────────────
    const { slackConfirm } = await inquirer.prompt([{
      type: "list",
      name: "slackConfirm",
      message: "💬 ¿Agregar al tablero de Slack?",
      choices: [
        { name: "✅ Sí", value: true  },
        { name: "❌ No", value: false },
      ],
    }]);

    if (!slackConfirm) return;

    // Comentario opcional
    const { slackComment } = await inquirer.prompt([{
      type: "input", name: "slackComment",
      message: "¿Algún comentario? (Enter para omitir)",
    }]);

    // Seleccionar assignee desde cache
    type Member = { id: string; name: string; display_name: string };
    let assigneeId = "";
    if (fs.existsSync(MEMBERS_CACHE)) {
      const cache   = JSON.parse(fs.readFileSync(MEMBERS_CACHE, "utf-8"));
      const members: Member[] = cache.members || [];
      if (members.length > 0) {
        const choices = members.map((m) => ({
          name: m.name + (m.display_name && m.display_name !== m.name ? ` (@${m.display_name})` : ""),
          value: m.id,
        }));
        choices.push({ name: chalk.dim("— Sin asignar —"), value: "" });
        const { assignee } = await inquirer.prompt([{
          type: "list", name: "assignee",
          message: "¿A quién asignar?",
          choices,
        }]);
        assigneeId = assignee;
      }
    } else {
      console.log(chalk.yellow("  ⚠️  Sin cache de miembros. Correr: g66 slack users --refresh"));
    }

    // Verificar / pedir my_user_id de Slack
    const G66_CONFIG = path.join(os.homedir(), ".g66-config.json");
    let g66cfg: any = {};
    try { g66cfg = JSON.parse(fs.readFileSync(G66_CONFIG, "utf-8")); } catch { /* ignorar */ }
    let myUserId: string = g66cfg?.slack?.my_user_id || "";

    if (!myUserId) {
      console.log(chalk.yellow("\n  Tu usuario de Slack no está configurado."));
      console.log("  1. En Slack, click en tu foto de perfil → 'Perfil'");
      console.log("  2. Click en ⋮ (tres puntos) → 'Copiar ID de miembro'\n");
      const ansId = await inquirer.prompt([{
        type: "input", name: "userId",
        message: "Pega tu Slack user ID (ej: U0XXXXXXXXX):",
        validate: (v: string) => v.trim().startsWith("U") || "ID inválido (debe empezar con U)",
      }]);
      myUserId = ansId.userId.trim();
      g66cfg.slack = { ...g66cfg.slack, my_user_id: myUserId };
      fs.writeFileSync(G66_CONFIG, JSON.stringify(g66cfg, null, 2), "utf-8");
      console.log(chalk.green("  ✅ Guardado en ~/.g66-config.json\n"));
    }

    let devName = myUserId;

    const slackTitle = `[${hu}] ${preview.title}`;
    const slackArgs = ["--action", "add", "--hu", hu, "--pr-url", result.pr_url,
                       "--title", slackTitle, "--env", env];
    if (devName) slackArgs.push("--dev-name", devName);
    if (assigneeId)              slackArgs.push("--assignee-id", assigneeId);
    if (slackComment?.trim())    slackArgs.push("--comments", slackComment.trim());

    const slackResult = spawnSync("python", [SLACK_SCRIPT, ...slackArgs], {
      encoding: "utf-8", stdio: ["inherit", "pipe", "pipe"],
    });
    const slackRaw = slackResult.stdout?.trim() || slackResult.stderr?.trim();
    try {
      const sd = JSON.parse(slackRaw);
      if (sd?.ok) console.log(chalk.green(`\n  ✅ Agregado al tablero via ${chalk.bold(sd.method)}\n`));
      else        console.error(chalk.red(`  ❌ Slack: ${sd?.error ?? "error desconocido"}`));
    } catch {
      console.error(chalk.red("  ❌ Slack: respuesta inválida"));
    }
  });

export default prSmart;
