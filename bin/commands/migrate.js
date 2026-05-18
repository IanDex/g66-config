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
const SCRIPT = path.join(__dirname, "..", "..", "scripts", "migrate_context.py");
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
const migrate = new commander_1.Command("migrate")
    .description("🗄️  Genera changeSet Liquibase desde cambios en entidades JPA con Claude")
    .option("--region <region>", "AWS region", "us-east-1")
    .option("--hu <hu>", "Código de HU explícito (ej: AT-108)")
    .option("--dry-run", "Solo mostrar el XML sin escribir el archivo")
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
    console.log(chalk_1.default.dim(`\n  Analizando entidades JPA con Claude...\n`));
    // ── 2. Generar XML ────────────────────────────────────────────────────
    const baseArgs = ["--cwd", cwd, "--hu", hu];
    const { data: preview, ok } = callScript([...baseArgs, "--dry-run"]);
    if (!ok || !preview) {
        console.error(chalk_1.default.red("❌ Error al analizar las entidades."));
        process.exit(1);
    }
    if (!preview.ok) {
        console.error(chalk_1.default.red(`❌ ${preview.error}`));
        process.exit(1);
    }
    // ── 3. Mostrar preview ────────────────────────────────────────────────
    console.log(chalk_1.default.bold(`  Servicio: ${chalk_1.default.cyan(preview.service)}  |  HU: ${chalk_1.default.blue(hu)}`));
    console.log(chalk_1.default.dim(`  Entidades detectadas:`));
    for (const f of (preview.entity_files ?? [])) {
        console.log(chalk_1.default.dim(`    • ${f}`));
    }
    console.log(chalk_1.default.dim(`\n  Directorio: ${preview.migration_dir}`));
    console.log(chalk_1.default.dim(`  Archivo sugerido: ${chalk_1.default.bold(preview.filename)}\n`));
    console.log(chalk_1.default.bold("  YAML generado:\n"));
    console.log(chalk_1.default.dim("  ─".repeat(50)));
    console.log(preview.yaml);
    console.log(chalk_1.default.dim("  ─".repeat(50)));
    const t = preview.tokens;
    if (t)
        console.log(chalk_1.default.dim(`\n  🪙 Tokens: ${t.input_tokens} entrada + ${t.output_tokens} salida = ${chalk_1.default.bold(t.total_tokens)} total`));
    if (opts.dryRun) {
        console.log(chalk_1.default.yellow("\n  [dry-run] Sin cambios.\n"));
        return;
    }
    // ── 4. Confirmar nombre de archivo ────────────────────────────────────
    const { filename } = await inquirer_1.default.prompt([{
            type: "input",
            name: "filename",
            message: "Nombre del archivo XML:",
            default: preview.filename,
            validate: (v) => v.trim().endsWith(".yaml") || "Debe terminar en .yaml",
        }]);
    const { confirm } = await inquirer_1.default.prompt([{
            type: "list",
            name: "confirm",
            message: `¿Escribir ${filename} en ${path.basename(preview.migration_dir)}?`,
            choices: [
                { name: "✅ Sí, crear archivo", value: "yes" },
                { name: "❌ Cancelar", value: "no" },
            ],
        }]);
    if (confirm !== "yes") {
        console.log(chalk_1.default.gray("\n🚫 Cancelado.\n"));
        return;
    }
    // ── 5. Escribir archivo ───────────────────────────────────────────────
    const outPath = path.join(preview.migration_dir, filename);
    if (fs.existsSync(outPath)) {
        console.error(chalk_1.default.red(`❌ Ya existe ${outPath}. Elige otro nombre.`));
        process.exit(1);
    }
    fs.writeFileSync(outPath, preview.yaml, "utf-8");
    console.log(chalk_1.default.green(`\n  ✅ Archivo creado: ${outPath}\n`));
});
exports.default = migrate;
