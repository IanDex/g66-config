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
const SCRIPT = path.join(__dirname, "..", "..", "scripts", "hotfix_context.py");
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
    { name: "Todos  (release + master + development)", value: "prod,ci,dev" },
    { name: "PROD + CI  (release + master)", value: "prod,ci" },
    { name: "Solo PROD  (release)", value: "prod" },
];
const hotfix = new commander_1.Command("hotfix")
    .description("🚨 Cherry-pick commits a release/master/development y crea PRs de hotfix")
    .option("--region <region>", "AWS region", "us-east-1")
    .option("--hu <hu>", "Código de HU o ticket (ej: AT-108)")
    .action(async (opts) => {
    const cwd = process.cwd();
    // ── 1. HU ─────────────────────────────────────────────────────────────
    let hu = opts.hu?.trim().toUpperCase() || inferHu() || "";
    if (!hu) {
        const ans = await inquirer_1.default.prompt([{
                type: "input",
                name: "hu",
                message: "¿Código del ticket a hotfix? (ej: AT-108)",
                validate: (v) => /^[A-Z]{2,6}-\d+$/i.test(v.trim()) || "Formato inválido",
            }]);
        hu = ans.hu.trim().toUpperCase();
    }
    // ── 2. Cargar commits recientes ───────────────────────────────────────
    console.log(chalk_1.default.dim("\n  Cargando commits recientes...\n"));
    const { data: listData, ok: listOk } = callScript(["--cwd", cwd, "--list"]);
    if (!listOk || !listData?.ok) {
        console.error(chalk_1.default.red("❌ No se pudieron obtener los commits."));
        process.exit(1);
    }
    const commits = listData.commits ?? [];
    if (!commits.length) {
        console.error(chalk_1.default.red("❌ No hay commits recientes."));
        process.exit(1);
    }
    // ── 3. Seleccionar commits ────────────────────────────────────────────
    const { selectedShas } = await inquirer_1.default.prompt([{
            type: "checkbox",
            name: "selectedShas",
            message: "¿Qué commits aplicar al hotfix? (espacio = marcar)",
            choices: commits.map(c => ({
                name: `${chalk_1.default.yellow(c.sha.slice(0, 7))}  ${c.message.slice(0, 65).padEnd(65)}  ${chalk_1.default.dim(c.date)}`,
                value: c.sha,
            })),
            validate: (v) => v.length > 0 || "Selecciona al menos un commit",
        }]);
    // ── 4. Seleccionar ambientes ──────────────────────────────────────────
    const { envSelection } = await inquirer_1.default.prompt([{
            type: "list",
            name: "envSelection",
            message: "¿A qué ambientes aplicar el hotfix?",
            choices: ENV_CHOICES,
        }]);
    // ── 5. Confirmar ──────────────────────────────────────────────────────
    const shaList = selectedShas.map((s) => s.slice(0, 7)).join(", ");
    console.log(chalk_1.default.dim(`\n  Commits: ${shaList}`));
    const { confirm } = await inquirer_1.default.prompt([{
            type: "list",
            name: "confirm",
            message: `¿Crear ramas hotfix + PRs para ${envSelection.toUpperCase().replace(/,/g, " + ")}?`,
            choices: [
                { name: "✅ Sí, crear hotfix", value: "yes" },
                { name: "❌ Cancelar", value: "no" },
            ],
        }]);
    if (confirm !== "yes") {
        console.log(chalk_1.default.gray("\n🚫 Cancelado.\n"));
        return;
    }
    // ── 6. Ejecutar ───────────────────────────────────────────────────────
    console.log(chalk_1.default.dim("\n  Creando ramas y PRs...\n"));
    const { data: result, ok: fullOk } = callScript([
        "--cwd", cwd,
        "--hu", hu,
        "--envs", envSelection,
        "--commits", selectedShas.join(","),
        "--region", opts.region,
    ]);
    if (!fullOk || !result?.ok) {
        console.error(chalk_1.default.red("❌ Error al crear el hotfix."));
        process.exit(1);
    }
    for (const [env, info] of Object.entries(result.results ?? {})) {
        const err = info.error;
        const prUrl = info.pr_url;
        const branch = info.branch;
        const tag = env.toUpperCase().padEnd(5);
        if (err) {
            console.log(chalk_1.default.red(`  ✗ ${tag} ${err}`));
        }
        else {
            console.log(chalk_1.default.green(`  ✅ ${tag} ${chalk_1.default.cyan(branch)}`));
            if (prUrl)
                console.log(chalk_1.default.dim(`       PR: ${prUrl}`));
            else
                console.log(chalk_1.default.yellow(`       ⚠ PR no pudo crearse`));
        }
    }
    console.log();
});
exports.default = hotfix;
