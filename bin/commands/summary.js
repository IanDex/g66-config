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
const SCRIPT = path.join(__dirname, "..", "..", "scripts", "summary_context.py");
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
const summary = new commander_1.Command("summary")
    .description("📝 Genera resumen ejecutivo de la HU y lo publica como comentario en Jira")
    .option("--region <region>", "AWS region", "us-east-1")
    .option("--hu <hu>", "Código de HU explícito (ej: AT-108)")
    .option("--dry-run", "Solo mostrar el resumen sin publicar en Jira")
    .action(async (opts) => {
    const cwd = process.cwd();
    // ── 1. HU ─────────────────────────────────────────────────────────────
    let hu = opts.hu?.trim().toUpperCase() || inferHu() || "";
    if (!hu) {
        const ans = await inquirer_1.default.prompt([{
                type: "input",
                name: "hu",
                message: "¿Código de la HU? (ej: AT-108)",
                validate: (v) => /^[A-Z]{2,6}-\d+$/i.test(v.trim()) || "Formato inválido",
            }]);
        hu = ans.hu.trim().toUpperCase();
    }
    console.log(chalk_1.default.dim(`\n  Generando resumen de ${hu} con Claude...\n`));
    // ── 2. Generar resumen ────────────────────────────────────────────────
    const baseArgs = ["--cwd", cwd, "--hu", hu];
    const { data: preview, ok } = callScript([...baseArgs, "--dry-run"]);
    if (!ok || !preview) {
        console.error(chalk_1.default.red("❌ Error al generar el resumen."));
        process.exit(1);
    }
    if (!preview.ok) {
        console.error(chalk_1.default.red(`❌ ${preview.error}`));
        process.exit(1);
    }
    // ── 3. Mostrar preview ────────────────────────────────────────────────
    console.log(chalk_1.default.bold(`  Servicio: ${chalk_1.default.cyan(preview.service)}  |  HU: ${chalk_1.default.blue(hu)}`));
    console.log(chalk_1.default.dim(`  Commits: ${preview.commits}  |  Archivos: ${preview.files}\n`));
    console.log(chalk_1.default.bold("  Resumen generado:\n"));
    console.log(chalk_1.default.dim("  ─".repeat(60)));
    console.log(preview.summary);
    console.log(chalk_1.default.dim("  ─".repeat(60)));
    const t = preview.tokens;
    if (t)
        console.log(chalk_1.default.dim(`\n  🪙 Tokens: ${t.input_tokens} entrada + ${t.output_tokens} salida = ${chalk_1.default.bold(t.total_tokens)} total`));
    if (opts.dryRun) {
        console.log(chalk_1.default.yellow("\n  [dry-run] Sin cambios en Jira.\n"));
        return;
    }
    // ── 4. Confirmar ──────────────────────────────────────────────────────
    const { confirm } = await inquirer_1.default.prompt([{
            type: "list",
            name: "confirm",
            message: `¿Publicar este resumen como comentario en ${hu}?`,
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
    console.log(chalk_1.default.dim("\n  Publicando en Jira...\n"));
    const { data: result, ok: fullOk } = callScript(baseArgs);
    if (!fullOk || !result?.ok) {
        console.error(chalk_1.default.red("❌ Error al publicar el resumen."));
        process.exit(1);
    }
    if (result.posted) {
        console.log(chalk_1.default.green(`  ✅ Resumen publicado en ${hu}\n`));
    }
    else {
        console.log(chalk_1.default.yellow("  ⚠ Resumen generado pero no se pudo publicar en Jira.\n"));
    }
});
exports.default = summary;
