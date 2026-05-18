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
const SCRIPT = path.join(__dirname, "..", "..", "scripts", "props_sync.py");
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
const ENV_CHOICES = [
    { name: "Todos  (dev + ci + prod)", value: "dev,ci,prod" },
    { name: "Dev y CI", value: "dev,ci" },
    { name: "Solo DEV", value: "dev" },
    { name: "Solo CI", value: "ci" },
    { name: "Solo PROD", value: "prod" },
];
const props = new commander_1.Command("props")
    .description("🔧 Detecta @Value properties faltantes y crea PRs en ms-config-properties (dev/ci/prod)")
    .option("--region <region>", "AWS region", "us-east-1")
    .option("--dry-run", "Solo mostrar qué falta sin modificar nada")
    .action(async (opts) => {
    const cwd = process.cwd();
    // ── 1. Inferir o preguntar HU ──────────────────────────────────────────
    let hu = inferHu();
    if (!hu) {
        const ans = await inquirer_1.default.prompt([{
                type: "input",
                name: "hu",
                message: "¿Cuál es el código de la HU? (ej: AT-108)",
                validate: (v) => /^[A-Z]{2,6}-\d+$/i.test(v.trim()) || "Formato inválido (ej: AT-108)",
            }]);
        hu = ans.hu.trim().toUpperCase();
    }
    console.log(chalk_1.default.dim(`\n  Escaneando @Value properties en archivos modificados de ${path.basename(cwd)}...`));
    // ── 2. Preview con todos los envs para detectar qué falta ─────────────
    const baseArgs = ["--cwd", cwd, "--hu", hu, "--envs", "dev,ci,prod", "--region", opts.region];
    const { data: preview, ok } = callScript([...baseArgs, "--dry-run"]);
    if (!ok || !preview) {
        console.error(chalk_1.default.red("❌ Error al analizar el proyecto."));
        process.exit(1);
    }
    if (!preview.ok) {
        console.error(chalk_1.default.red(`❌ ${preview.error}`));
        process.exit(1);
    }
    // ── 3. Mostrar resultados del scan ────────────────────────────────────
    console.log(chalk_1.default.bold(`\n  Servicio: ${chalk_1.default.cyan(preview.service)}  |  HU: ${chalk_1.default.blue(hu)}`));
    console.log(chalk_1.default.dim(`  Archivos escaneados (committed + staged + unstaged + untracked):`));
    for (const f of (preview.scanned_files ?? []).slice(0, 10)) {
        console.log(chalk_1.default.dim(`    • ${f}`));
    }
    console.log(chalk_1.default.dim(`  @Value encontradas: ${preview.total_code_props}`));
    console.log();
    const results = preview.results ?? {};
    let totalMissing = 0;
    // Recopilar properties sin default de TODOS los envs (deduplicado)
    const noDefaultKeys = new Set();
    for (const [env, info] of Object.entries(results)) {
        const added = info.added ?? [];
        const details = info.details ?? [];
        const envError = info.error;
        const tag = env.toUpperCase().padEnd(5);
        if (envError) {
            console.log(chalk_1.default.red(`  ✗ ${tag} ${envError}`));
        }
        else if (added.length === 0) {
            console.log(chalk_1.default.green(`  ✓ ${tag} todas las properties existen`));
        }
        else {
            totalMissing += added.length;
            console.log(chalk_1.default.yellow(`  ⚠ ${tag} ${added.length} faltantes:`));
            for (const key of added) {
                console.log(chalk_1.default.dim(`        • ${key}`));
            }
            for (const d of details) {
                if (d.default === null || d.default === undefined || d.default === "") {
                    noDefaultKeys.add(d.key);
                }
            }
        }
    }
    console.log();
    if (totalMissing === 0) {
        console.log(chalk_1.default.green.bold("  ✅ ms-config-properties completo — no falta nada.\n"));
        return;
    }
    if (opts.dryRun) {
        console.log(chalk_1.default.yellow(`  [dry-run] ${totalMissing} properties serían agregadas.\n`));
        return;
    }
    // ── 4. Pedir valores para properties sin default ──────────────────────
    const explicitValues = {};
    if (noDefaultKeys.size > 0) {
        console.log(chalk_1.default.yellow(`\n  Las siguientes properties no tienen valor por defecto.\n  Debes proveer un valor para continuar:\n`));
        for (const key of noDefaultKeys) {
            const { val } = await inquirer_1.default.prompt([{
                    type: "input",
                    name: "val",
                    message: `  ${chalk_1.default.cyan(key)} =`,
                    validate: (v) => v.trim().length > 0 || "El valor no puede estar vacío",
                }]);
            explicitValues[key] = val.trim();
        }
        console.log();
    }
    // ── 5. Selección de environments (solo si hay algo que agregar) ────────
    const { envSelection } = await inquirer_1.default.prompt([{
            type: "list",
            name: "envSelection",
            message: `¿Para qué environments crear PRs en ms-config-properties?`,
            choices: ENV_CHOICES,
        }]);
    // ── 6. Confirmar ──────────────────────────────────────────────────────
    const { confirm } = await inquirer_1.default.prompt([{
            type: "list",
            name: "confirm",
            message: `¿Crear branch + commit + PR para ${envSelection.toUpperCase().replace(/,/g, " + ")}?`,
            choices: [
                { name: "✅ Sí, crear PRs", value: "yes" },
                { name: "❌ Cancelar", value: "no" },
            ],
        }]);
    if (confirm !== "yes") {
        console.log(chalk_1.default.gray("\n🚫 Cancelado.\n"));
        return;
    }
    // ── 7. Ejecutar ───────────────────────────────────────────────────────
    console.log(chalk_1.default.dim("  Aplicando cambios y creando PRs...\n"));
    const finalArgs = ["--cwd", cwd, "--hu", hu, "--envs", envSelection, "--region", opts.region];
    if (Object.keys(explicitValues).length > 0) {
        finalArgs.push("--values", JSON.stringify(explicitValues));
    }
    const { data: result, ok: fullOk } = callScript(finalArgs);
    if (!fullOk || !result?.ok) {
        console.error(chalk_1.default.red("❌ Error al aplicar los cambios."));
        process.exit(1);
    }
    for (const [env, info] of Object.entries(result.results ?? {})) {
        const added = info.added ?? [];
        const envError = info.error;
        const tag = env.toUpperCase().padEnd(5);
        if (envError) {
            console.log(chalk_1.default.red(`  ✗ ${tag} ${envError}`));
        }
        else if (added.length > 0) {
            const prUrl = info.pr_url ?? null;
            console.log(chalk_1.default.green(`  ✅ ${tag} ${added.length} properties agregadas`));
            if (prUrl) {
                console.log(chalk_1.default.cyan(`     PR: ${prUrl}`));
            }
            else {
                console.log(chalk_1.default.yellow(`     ⚠ PR no pudo crearse (verificar AWS CLI)`));
            }
        }
    }
    console.log();
});
exports.default = props;
