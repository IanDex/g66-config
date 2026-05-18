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
const SCRIPT = path.join(__dirname, "..", "..", "scripts", "contract_context.py");
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
function inferHu() {
    try {
        const branch = (0, child_process_1.execSync)("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
        const parts = branch.split("/");
        return parts.length >= 3 ? parts[parts.length - 1].toUpperCase() : null;
    }
    catch {
        return null;
    }
}
const contract = new commander_1.Command("contract")
    .description("📄 Genera contratos de endpoints modificados y los publica como comentario en la HU de Jira")
    .option("--region <region>", "AWS region", "us-east-1")
    .option("--hu <hu>", "Código de HU explícito (ej: AT-106)")
    .option("--dry-run", "Solo mostrar los contratos sin publicar en Jira")
    .option("--class <fqn>", "Clase específica: com.pkg.ClassName o ClassName#method")
    .action(async (opts) => {
    const cwd = process.cwd();
    // ── 1. Inferir o preguntar HU ─────────────────────────────────────────
    let hu = opts.hu?.trim().toUpperCase() || inferHu() || "";
    if (!hu) {
        const ans = await inquirer_1.default.prompt([{
                type: "input",
                name: "hu",
                message: "¿Cuál es el código de la HU? (ej: AT-108)",
                validate: (v) => /^[A-Z]{2,6}-\d+$/i.test(v.trim()) || "Formato inválido (ej: AT-108)",
            }]);
        hu = ans.hu.trim().toUpperCase();
    }
    console.log(chalk_1.default.dim(`\n  Analizando endpoints en ${path.basename(cwd)} con Claude...\n`));
    // ── 2. Dry-run: generar contratos sin publicar ────────────────────────
    const baseArgs = ["--cwd", cwd, "--hu", hu, "--region", opts.region];
    if (opts.class)
        baseArgs.push("--class", opts.class);
    const { data: preview, ok } = callScript([...baseArgs, "--dry-run"]);
    if (!ok || !preview) {
        console.error(chalk_1.default.red("❌ Error al analizar los controladores."));
        process.exit(1);
    }
    if (!preview.ok) {
        console.error(chalk_1.default.red(`❌ ${preview.error}`));
        process.exit(1);
    }
    const endpoints = preview.endpoints ?? [];
    // ── 3. Mostrar preview ────────────────────────────────────────────────
    console.log(chalk_1.default.bold(`  Servicio: ${chalk_1.default.cyan(preview.service)}  |  HU: ${chalk_1.default.blue(hu)}`));
    console.log(chalk_1.default.dim(`  Endpoints detectados: ${endpoints.length}\n`));
    for (const ep of endpoints) {
        const method = (ep.method ?? "").toUpperCase();
        const color = method === "GET" ? chalk_1.default.green : method === "DELETE" ? chalk_1.default.red : chalk_1.default.yellow;
        console.log(`  ${color(method.padEnd(7))} ${chalk_1.default.bold(ep.path)}`);
        console.log(chalk_1.default.dim(`           ${ep.description ?? ""}`));
        if (ep.headers?.length) {
            console.log(chalk_1.default.dim(`           Headers: ${ep.headers.map((h) => h.name).join(", ")}`));
        }
        const reqFields = ep.request_body?.fields?.length ?? 0;
        const resFields = ep.response_body?.fields?.length ?? 0;
        if (reqFields)
            console.log(chalk_1.default.dim(`           Request:  ${reqFields} campo(s)`));
        if (resFields)
            console.log(chalk_1.default.dim(`           Response: ${resFields} campo(s)`));
        console.log();
    }
    if (opts.dryRun) {
        const t = preview.tokens;
        if (t)
            console.log(chalk_1.default.dim(`  🪙 Tokens: ${t.input_tokens} entrada + ${t.output_tokens} salida = ${chalk_1.default.bold(t.total_tokens)} total`));
        console.log(chalk_1.default.yellow("\n  [dry-run] Contratos generados — no se publicó en Jira.\n"));
        return;
    }
    // ── 4. Confirmar publicación en Jira ──────────────────────────────────
    const { confirm } = await inquirer_1.default.prompt([{
            type: "list",
            name: "confirm",
            message: `¿Publicar ${endpoints.length} contrato(s) como comentario en ${hu}?`,
            choices: [
                { name: "✅ Sí, publicar en Jira", value: "yes" },
                { name: "❌ Cancelar", value: "no" },
            ],
        }]);
    if (confirm !== "yes") {
        console.log(chalk_1.default.gray("\n🚫 Cancelado.\n"));
        return;
    }
    // ── 5. Publicar ───────────────────────────────────────────────────────
    console.log(chalk_1.default.dim("  Publicando en Jira...\n"));
    const { data: result, ok: fullOk } = callScript(baseArgs);
    if (!fullOk || !result?.ok) {
        console.error(chalk_1.default.red("❌ Error al publicar el contrato."));
        process.exit(1);
    }
    if (result.jira_posted) {
        console.log(chalk_1.default.green(`  ✅ Comentario publicado en ${hu}`));
    }
    else {
        console.log(chalk_1.default.yellow("  ⚠ Contratos generados pero no se pudo publicar en Jira (verificar credenciales)."));
    }
    const tokens = result.tokens;
    if (tokens) {
        console.log(chalk_1.default.dim(`\n  🪙 Tokens usados: ${tokens.input_tokens} entrada + ${tokens.output_tokens} salida = ${chalk_1.default.bold(tokens.total_tokens)} total\n`));
    }
});
exports.default = contract;
