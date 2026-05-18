"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const child_process_1 = require("child_process");
const inquirer_1 = __importDefault(require("inquirer"));
const chalk_1 = __importDefault(require("chalk"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const git_utils_1 = require("../utils/git-utils");
const SCRIPT = path.join(__dirname, "..", "..", "scripts", "pr_ai.py");
const SLACK_SCRIPT = path.join(__dirname, "..", "..", "scripts", "slack_context.py");
const SYNC_ALL = path.join(__dirname, "..", "..", "vendor", "apigw", "scripts", "sync_all_envs.ps1");
const MEMBERS_CACHE = path.join(os.homedir(), ".g66-slack-members.json");
function callScript(extraArgs = []) {
    const result = (0, child_process_1.spawnSync)("python", [SCRIPT, ...extraArgs], {
        encoding: "utf-8",
        stdio: ["inherit", "pipe", "pipe"],
    });
    const raw = result.stdout?.trim() || result.stderr?.trim();
    if (!raw)
        return { data: null, ok: false };
    try {
        const data = JSON.parse(raw);
        return { data, ok: !!data };
    }
    catch {
        return { data: null, ok: false };
    }
}
function runApigw(repo, hu, env) {
    const argStr = `-Repo "${repo}" -Hu "${hu}" -Envs "${env}"`;
    const cmd = `pwsh -ExecutionPolicy Bypass -NoProfile -File "${SYNC_ALL}" ${argStr}`;
    console.log(chalk_1.default.dim(`\n→ ${cmd}\n`));
    try {
        (0, child_process_1.execSync)(cmd, { stdio: "inherit" });
    }
    catch {
        console.error(chalk_1.default.red("❌ apigw sync falló — revisá el error arriba."));
    }
}
function getRepoPath() {
    try {
        return (0, child_process_1.execSync)("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim().replace(/\//g, "\\");
    }
    catch {
        return process.cwd();
    }
}
const prSmart = new commander_1.Command("pr-smart")
    .description("🤖 Push + PR en CodeCommit con título y descripción generados por IA")
    .option("--dry-run", "Solo muestra el PR generado sin commitear ni crear")
    .option("--mock", "Simula el PR (sin commit/push/PR real) para testear flujos post-PR")
    .option("--region <region>", "AWS region", "us-east-1")
    .option("--apigw", "Sincronizar API Gateway automáticamente sin preguntar")
    .option("--no-apigw-prompt", "Omitir pregunta de API Gateway al final")
    .action(async (opts) => {
    let branch;
    try {
        branch = (0, git_utils_1.getCurrentBranch)();
    }
    catch (e) {
        console.error(chalk_1.default.red(e.message));
        process.exit(1);
    }
    const match = branch.match(/[^/]+\/([^/]+)\/(.+)/);
    const hu = match ? match[2].toUpperCase() : null;
    const env = match ? match[1].toLowerCase() : "dev";
    if (!hu) {
        console.error(chalk_1.default.red(`\n🚫 Rama '${branch}' no sigue el formato user/env/HU.\n`));
        process.exit(1);
    }
    console.log(chalk_1.default.blue(`\n🌿 Rama: ${branch}`));
    console.log(chalk_1.default.blue(`🔖 HU:   ${hu}\n`));
    // Preview
    console.log(chalk_1.default.dim("  Analizando diff con Claude..."));
    const { data: preview, ok } = callScript(["--dry-run", "--region", opts.region]);
    if (!ok || !preview) {
        console.error(chalk_1.default.red("❌ Error al generar el PR."));
        process.exit(1);
    }
    console.log(chalk_1.default.bold.cyan("\n📋 PR generado:\n"));
    console.log(chalk_1.default.bold("Título:"));
    console.log(`  ${preview.title}\n`);
    console.log(chalk_1.default.bold("Descripción:"));
    console.log(chalk_1.default.dim(preview.description));
    if (opts.dryRun) {
        console.log(chalk_1.default.yellow("\n[dry-run] Sin cambios.\n"));
        return;
    }
    const { confirm } = await inquirer_1.default.prompt([
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
        console.log(chalk_1.default.gray("\n🚫 Cancelado.\n"));
        return;
    }
    // Pipeline completo (o mock)
    let result;
    if (opts.mock) {
        result = {
            is_new: true,
            pr_id: "999",
            pr_url: `https://us-east-1.console.aws.amazon.com/codesuite/codecommit/repositories/ms-business-api/pull-requests/999/details`,
            tokens: null,
        };
        console.log(chalk_1.default.yellow("\n  [mock] Saltando commit/push/PR real.\n"));
    }
    else {
        const { data, ok: fullOk } = callScript(["--region", opts.region]);
        if (!fullOk || !data) {
            console.error(chalk_1.default.red("❌ Pipeline falló."));
            process.exit(1);
        }
        result = data;
    }
    const action = result.is_new ? "creado" : "actualizado";
    console.log(chalk_1.default.green(`\n✅ PR #${result.pr_id} ${action}!`));
    console.log(chalk_1.default.cyan(`🔗 ${result.pr_url}`));
    const t = result.tokens;
    if (t)
        console.log(chalk_1.default.dim(`  🪙 Tokens: ${t.input_tokens} entrada + ${t.output_tokens} salida = ${t.total_tokens} total\n`));
    // ── API Gateway sync ──────────────────────────────────────────────────
    if (opts.noApigwPrompt)
        return;
    let syncApigw = opts.apigw;
    if (!syncApigw) {
        const { apigwConfirm } = await inquirer_1.default.prompt([
            {
                type: "list",
                name: "apigwConfirm",
                message: "🔀 ¿Sincronizar API Gateway?",
                choices: [
                    { name: "✅ Sí", value: true },
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
    const { slackConfirm } = await inquirer_1.default.prompt([{
            type: "list",
            name: "slackConfirm",
            message: "💬 ¿Agregar al tablero de Slack?",
            choices: [
                { name: "✅ Sí", value: true },
                { name: "❌ No", value: false },
            ],
        }]);
    if (!slackConfirm)
        return;
    // Comentario opcional
    const { slackComment } = await inquirer_1.default.prompt([{
            type: "input", name: "slackComment",
            message: "¿Algún comentario? (Enter para omitir)",
        }]);
    let assigneeId = "";
    if (fs.existsSync(MEMBERS_CACHE)) {
        const cache = JSON.parse(fs.readFileSync(MEMBERS_CACHE, "utf-8"));
        const members = cache.members || [];
        if (members.length > 0) {
            const choices = members.map((m) => ({
                name: m.name + (m.display_name && m.display_name !== m.name ? ` (@${m.display_name})` : ""),
                value: m.id,
            }));
            choices.push({ name: chalk_1.default.dim("— Sin asignar —"), value: "" });
            const { assignee } = await inquirer_1.default.prompt([{
                    type: "list", name: "assignee",
                    message: "¿A quién asignar?",
                    choices,
                }]);
            assigneeId = assignee;
        }
    }
    else {
        console.log(chalk_1.default.yellow("  ⚠️  Sin cache de miembros. Correr: g66 slack users --refresh"));
    }
    // Verificar / pedir my_user_id de Slack
    const G66_CONFIG = path.join(os.homedir(), ".g66-config.json");
    let g66cfg = {};
    try {
        g66cfg = JSON.parse(fs.readFileSync(G66_CONFIG, "utf-8"));
    }
    catch { /* ignorar */ }
    let myUserId = g66cfg?.slack?.my_user_id || "";
    if (!myUserId) {
        console.log(chalk_1.default.yellow("\n  Tu usuario de Slack no está configurado."));
        console.log("  1. En Slack, click en tu foto de perfil → 'Perfil'");
        console.log("  2. Click en ⋮ (tres puntos) → 'Copiar ID de miembro'\n");
        const ansId = await inquirer_1.default.prompt([{
                type: "input", name: "userId",
                message: "Pega tu Slack user ID (ej: U0XXXXXXXXX):",
                validate: (v) => v.trim().startsWith("U") || "ID inválido (debe empezar con U)",
            }]);
        myUserId = ansId.userId.trim();
        g66cfg.slack = { ...g66cfg.slack, my_user_id: myUserId };
        fs.writeFileSync(G66_CONFIG, JSON.stringify(g66cfg, null, 2), "utf-8");
        console.log(chalk_1.default.green("  ✅ Guardado en ~/.g66-config.json\n"));
    }
    let devName = myUserId;
    const slackTitle = `[${hu}] ${preview.title}`;
    const slackArgs = ["--action", "add", "--hu", hu, "--pr-url", result.pr_url,
        "--title", slackTitle, "--env", env];
    if (devName)
        slackArgs.push("--dev-name", devName);
    if (assigneeId)
        slackArgs.push("--assignee-id", assigneeId);
    if (slackComment?.trim())
        slackArgs.push("--comments", slackComment.trim());
    const slackResult = (0, child_process_1.spawnSync)("python", [SLACK_SCRIPT, ...slackArgs], {
        encoding: "utf-8", stdio: ["inherit", "pipe", "pipe"],
    });
    const slackRaw = slackResult.stdout?.trim() || slackResult.stderr?.trim();
    try {
        const sd = JSON.parse(slackRaw);
        if (sd?.ok)
            console.log(chalk_1.default.green(`\n  ✅ Agregado al tablero via ${chalk_1.default.bold(sd.method)}\n`));
        else
            console.error(chalk_1.default.red(`  ❌ Slack: ${sd?.error ?? "error desconocido"}`));
    }
    catch {
        console.error(chalk_1.default.red("  ❌ Slack: respuesta inválida"));
    }
});
exports.default = prSmart;
