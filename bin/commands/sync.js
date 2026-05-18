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
const STATUS_SCRIPT = path.join(__dirname, "..", "..", "scripts", "env_status_context.py");
const SYNC_SCRIPT = path.join(__dirname, "..", "..", "scripts", "sync_context.py");
function callScript(script, pyArgs) {
    const result = (0, child_process_1.spawnSync)("python", [script, ...pyArgs], {
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
const BRANCH_LABEL = {
    release: "PROD (release)",
    master: "CI   (master)",
    development: "DEV  (development)",
};
const BRANCHES = ["release", "master", "development"];
const sync = new commander_1.Command("sync")
    .description("🔄 Sincroniza HUs entre ambientes con cherry-pick + spotless + push directo")
    .option("--dry-run", "Mostrar qué commits se aplicarían sin hacer cambios")
    .action(async (opts) => {
    const cwd = process.cwd();
    console.log(chalk_1.default.dim("\n  Cargando estado de ambientes...\n"));
    // ── 1. Cargar status ──────────────────────────────────────────────────
    const { data: statusData, ok: statusOk } = callScript(STATUS_SCRIPT, ["--cwd", cwd]);
    if (!statusOk || !statusData?.ok) {
        console.error(chalk_1.default.red("❌ No se pudo obtener el estado de los ambientes."));
        process.exit(1);
    }
    const matrix = statusData.matrix ?? [];
    const branches = statusData.branches ?? BRANCHES;
    // Mostrar tabla
    const col = 12;
    const colW = 8;
    console.log(chalk_1.default.bold("  " + "HU".padEnd(col) +
        branches.map((b) => (BRANCH_LABEL[b]?.slice(0, 6) ?? b).padEnd(colW)).join("")));
    console.log(chalk_1.default.dim("  " + "─".repeat(col + branches.length * colW)));
    for (const row of matrix) {
        const allIn = branches.every((b) => row[b]);
        const cells = branches.map((b) => {
            const symbol = row[b] ? " ok  " : " --  ";
            return row[b] ? chalk_1.default.green(symbol.padEnd(colW)) : chalk_1.default.red(symbol.padEnd(colW));
        });
        const hu = row.hu.padEnd(col);
        console.log("  " + (allIn ? chalk_1.default.green(hu) : chalk_1.default.yellow(hu)) + cells.join(""));
    }
    console.log();
    // HUs no completamente homologadas
    const pendingHus = matrix.filter(r => !branches.every((b) => r[b]));
    if (!pendingHus.length) {
        console.log(chalk_1.default.green.bold("  ✅ Todos los ambientes ya están homologados.\n"));
        return;
    }
    // ── 2. Seleccionar source ─────────────────────────────────────────────
    const { source } = await inquirer_1.default.prompt([{
            type: "list",
            name: "source",
            message: "¿Desde qué ambiente tomar los cambios?",
            choices: branches.map(b => ({ name: BRANCH_LABEL[b] ?? b, value: b })),
        }]);
    // ── 3. Seleccionar target ─────────────────────────────────────────────
    const targetBranches = branches.filter(b => b !== source);
    const { target } = await inquirer_1.default.prompt([{
            type: "list",
            name: "target",
            message: "¿A qué ambiente aplicar los cambios?",
            choices: targetBranches.map(b => ({ name: BRANCH_LABEL[b] ?? b, value: b })),
        }]);
    // HUs que están en source pero NO en target
    const syncable = matrix.filter(r => r[source] && !r[target]);
    if (!syncable.length) {
        console.log(chalk_1.default.green(`\n  ✅ No hay HUs de ${source} que falten en ${target}.\n`));
        return;
    }
    // ── 4. Seleccionar HUs ────────────────────────────────────────────────
    const { selectedHus } = await inquirer_1.default.prompt([{
            type: "checkbox",
            name: "selectedHus",
            message: `¿Qué HUs sincronizar de ${BRANCH_LABEL[source] ?? source} → ${BRANCH_LABEL[target] ?? target}?`,
            choices: syncable.map(r => ({ name: r.hu, value: r.hu })),
            validate: (v) => v.length > 0 || "Selecciona al menos una HU",
        }]);
    // ── 5. Preview commits ────────────────────────────────────────────────
    console.log(chalk_1.default.dim("\n  Verificando commits...\n"));
    const { data: preview } = callScript(SYNC_SCRIPT, [
        "--cwd", cwd,
        "--source", source,
        "--target", target,
        "--hus", selectedHus.join(","),
        "--dry-run",
    ]);
    if (preview?.commits?.length) {
        console.log(chalk_1.default.dim(`  Commits a aplicar (${preview.commits.length}):`));
        for (const c of preview.commits) {
            console.log(chalk_1.default.dim(`    ${chalk_1.default.yellow(c.sha)} ${c.msg.slice(0, 70)}`));
        }
        console.log();
    }
    if (preview?.ignore?.length) {
        console.log(chalk_1.default.dim(`  Archivos excluidos: ${preview.ignore.join(", ")}\n`));
    }
    // ── 6. Confirmar ──────────────────────────────────────────────────────
    const { confirm } = await inquirer_1.default.prompt([{
            type: "list",
            name: "confirm",
            message: `¿Aplicar ${selectedHus.join(", ")} en ${target} con spotless y push directo?`,
            choices: [
                { name: "✅ Sí, sincronizar", value: "yes" },
                { name: "❌ Cancelar", value: "no" },
            ],
        }]);
    if (confirm !== "yes") {
        console.log(chalk_1.default.gray("\n🚫 Cancelado.\n"));
        return;
    }
    // ── 7. Ejecutar ───────────────────────────────────────────────────────
    const syncArgs = [
        "--cwd", cwd,
        "--source", source,
        "--target", target,
        "--hus", selectedHus.join(","),
    ];
    if (opts.dryRun)
        syncArgs.push("--dry-run");
    console.log(chalk_1.default.dim("\n  Aplicando cambios...\n"));
    const { data: result, ok: syncOk } = callScript(SYNC_SCRIPT, syncArgs);
    if (!syncOk || !result?.ok) {
        console.error(chalk_1.default.red(`❌ ${result?.error ?? "Error al sincronizar."}`));
        if (result?.conflicts?.length) {
            console.log(chalk_1.default.yellow("\n  Conflictos:"));
            for (const c of result.conflicts) {
                console.log(chalk_1.default.red(`    ${c.sha} — ${c.error}`));
            }
        }
        process.exit(1);
    }
    console.log(chalk_1.default.green(`\n  ✅ ${result.applied?.length} commit(s) aplicados en ${target}`));
    for (const c of (result.applied ?? [])) {
        const restored = c.restored?.length ? chalk_1.default.dim(` (excluidos: ${c.restored.join(", ")})`) : "";
        console.log(chalk_1.default.dim(`    ${c.sha} ${c.msg.slice(0, 60)}${restored}`));
    }
    if (result.conflicts?.length) {
        console.log(chalk_1.default.yellow(`\n  ⚠ ${result.conflicts.length} commit(s) con conflicto — resolver manualmente:`));
        for (const c of result.conflicts) {
            console.log(chalk_1.default.red(`    ${c.sha} ${c.msg.slice(0, 60)}`));
        }
    }
    if (result.spotless === false) {
        console.log(chalk_1.default.yellow("  ⚠ Spotless falló — revisar antes de merge."));
    }
    console.log();
});
exports.default = sync;
