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
const MEMBERS_CACHE = path.join(os.homedir(), ".g66-slack-members.json");
const SCRIPT = path.join(__dirname, "..", "..", "scripts", "slack_context.py");
function callScript(pyArgs) {
    const result = (0, child_process_1.spawnSync)("python", [SCRIPT, ...pyArgs], {
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
const slack = new commander_1.Command("slack")
    .description("💬 Interacción con tableros Slack Lists")
    .addCommand(new commander_1.Command("test")
    .description("Verificar token y conexión con el canal")
    .action(() => {
    const { data, ok } = callScript(["--action", "test"]);
    if (!ok || !data?.ok) {
        console.error(chalk_1.default.red(`❌ ${data?.error ?? "Error al conectar con Slack."}`));
        process.exit(1);
    }
    console.log(chalk_1.default.green(`\n  ✅ Conectado como ${chalk_1.default.bold(data.user)} (${data.team})`));
    console.log(chalk_1.default.dim(`  Canal: #${data.channel} (${data.channel_id})\n`));
}))
    .addCommand(new commander_1.Command("discover")
    .description("Descubrir tableros/lists disponibles en el canal")
    .action(() => {
    console.log(chalk_1.default.dim("\n  Explorando el canal...\n"));
    const { data, ok } = callScript(["--action", "discover"]);
    if (!ok || !data?.ok) {
        console.error(chalk_1.default.red("❌ Error al explorar el canal."));
        process.exit(1);
    }
    console.log(chalk_1.default.bold("  Respuesta de APIs:\n"));
    console.log(JSON.stringify(data.discovery, null, 2));
    console.log();
}))
    .addCommand(new commander_1.Command("users")
    .description("Listar miembros del canal de devs (con su Slack user ID)")
    .option("--refresh", "Forzar actualización desde Slack (ignorar cache)")
    .action((opts) => {
    let members;
    let updatedAt;
    let fromCache = false;
    if (!opts.refresh && fs.existsSync(MEMBERS_CACHE)) {
        const cache = JSON.parse(fs.readFileSync(MEMBERS_CACHE, "utf-8"));
        members = cache.members || [];
        updatedAt = new Date(cache.updated_at).toLocaleString("es-CL");
        fromCache = true;
    }
    else {
        const { data, ok } = callScript(["--action", "users"]);
        if (!ok || !data?.ok) {
            console.error(chalk_1.default.red(`❌ ${data?.error ?? "Error al obtener miembros."}`));
            process.exit(1);
        }
        members = data.members || [];
        updatedAt = new Date().toLocaleString("es-CL");
        const cache = { updated_at: new Date().toISOString(), members };
        fs.writeFileSync(MEMBERS_CACHE, JSON.stringify(cache, null, 2), "utf-8");
    }
    const source = fromCache ? chalk_1.default.dim("(cache local)") : chalk_1.default.yellow("(actualizado desde Slack)");
    console.log(chalk_1.default.bold(`\n  Miembros del canal (${members.length}) — ${updatedAt} ${source}\n`));
    for (const m of members) {
        console.log(`  ${chalk_1.default.cyan(m.id.padEnd(14))} ${m.name}${m.display_name && m.display_name !== m.name ? chalk_1.default.dim(` (@${m.display_name})`) : ""}`);
    }
    console.log();
}))
    .addCommand(new commander_1.Command("add")
    .description("Agregar un item al tablero")
    .option("--hu <hu>", "Código de HU (ej: AT-110)")
    .option("--pr-url <url>", "URL del PR en CodeCommit")
    .option("--title <title>", "Título del item")
    .option("--assignee-id <id>", "Slack user ID del asignado (omitir para seleccionar)")
    .option("--list-id <id>", "ID del tablero/list de Slack")
    .action(async (opts) => {
    let { hu, prUrl, title, assigneeId, listId } = opts;
    // Inferir HU desde la rama
    if (!hu) {
        try {
            const branch = (0, child_process_1.execSync)("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
            const match = branch.match(/([A-Z]{2,6}-\d+)/);
            if (match)
                hu = match[1];
        }
        catch { /* fuera de un repo git */ }
    }
    if (!hu) {
        const ans = await inquirer_1.default.prompt([{
                type: "input", name: "hu",
                message: "¿Código de la HU? (ej: AT-110)",
            }]);
        hu = ans.hu.trim().toUpperCase();
    }
    // Detectar env desde la rama
    let env = "";
    try {
        const branch = (0, child_process_1.execSync)("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
        const envMatch = branch.match(/^[^/]+\/([^/]+)\//);
        if (envMatch)
            env = envMatch[1]; // dev | ci | prod
    }
    catch { /* ignorar */ }
    // PR URL fake para pruebas si no se provee
    if (!prUrl) {
        prUrl = `https://us-east-1.console.aws.amazon.com/codesuite/codecommit/repositories/ms-business-api/pull-requests/999/details`;
    }
    // Verificar / pedir my_user_id
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
    // Comentario opcional
    let comments = "";
    const ansComments = await inquirer_1.default.prompt([{
            type: "input", name: "comments",
            message: "¿Algún comentario? (Enter para omitir)",
        }]);
    comments = ansComments.comments.trim();
    // Seleccionar assignee desde cache
    if (!assigneeId) {
        let members = [];
        if (fs.existsSync(MEMBERS_CACHE)) {
            const cache = JSON.parse(fs.readFileSync(MEMBERS_CACHE, "utf-8"));
            members = cache.members || [];
        }
        if (members.length === 0) {
            console.log(chalk_1.default.yellow("  ⚠️  Sin cache de miembros. Correr: g66 slack users --refresh"));
        }
        else {
            const choices = members.map((m) => ({
                name: m.name + (m.display_name && m.display_name !== m.name ? ` (@${m.display_name})` : ""),
                value: m.id,
            }));
            choices.push({ name: chalk_1.default.dim("— Sin asignar —"), value: "" });
            const ans = await inquirer_1.default.prompt([{
                    type: "list", name: "assignee",
                    message: "¿A quién asignar?",
                    choices,
                }]);
            assigneeId = ans.assignee;
        }
    }
    const fullTitle = title || (hu ? `[${hu}] PR` : "PR");
    const args = ["--action", "add"];
    if (hu)
        args.push("--hu", hu);
    if (prUrl)
        args.push("--pr-url", prUrl);
    args.push("--title", fullTitle);
    if (assigneeId)
        args.push("--assignee-id", assigneeId);
    if (comments)
        args.push("--comments", comments);
    if (env)
        args.push("--env", env);
    if (listId)
        args.push("--list-id", listId);
    const { data, ok } = callScript(args);
    if (!ok || !data?.ok) {
        console.error(chalk_1.default.red(`❌ ${data?.error ?? "Error al agregar item."}`));
        process.exit(1);
    }
    console.log(chalk_1.default.green(`\n  ✅ Item agregado via ${chalk_1.default.bold(data.method)}`));
    if (data.ts)
        console.log(chalk_1.default.dim(`  ts: ${data.ts}`));
    console.log();
}));
exports.default = slack;
