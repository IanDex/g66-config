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
const chalk_1 = __importDefault(require("chalk"));
const path = __importStar(require("path"));
const SCRIPT = path.join(__dirname, "..", "..", "scripts", "env_status_context.py");
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
const BRANCH_LABEL = {
    release: "PROD",
    master: "CI  ",
    development: "DEV ",
};
const envStatus = new commander_1.Command("env-status")
    .description("📊 Muestra qué HUs están en PROD / CI / DEV")
    .action(() => {
    const cwd = process.cwd();
    console.log(chalk_1.default.dim("\n  Consultando ramas (fetch)...\n"));
    const { data, ok } = callScript(["--cwd", cwd]);
    if (!ok || !data?.ok) {
        console.error(chalk_1.default.red("❌ Error al obtener el estado de los ambientes."));
        process.exit(1);
    }
    const matrix = data.matrix ?? [];
    const branches = data.branches ?? ["release", "master", "development"];
    // Header
    const col = 12;
    const colW = 8;
    const header = "  " + "HU".padEnd(col) +
        branches.map((b) => (BRANCH_LABEL[b] ?? b).padEnd(colW)).join("");
    console.log(chalk_1.default.bold(header));
    console.log(chalk_1.default.dim("  " + "─".repeat(col + branches.length * colW)));
    let missing = 0;
    for (const row of matrix) {
        const states = branches.map((b) => row[b]);
        const allIn = states.every(Boolean);
        const noneIn = states.every((s) => !s);
        if (noneIn)
            continue;
        const cells = branches.map((b) => {
            const val = row[b];
            const symbol = val ? " ok  " : " --  "; // mismo ancho siempre
            return val ? chalk_1.default.green(symbol.padEnd(colW)) : chalk_1.default.red(symbol.padEnd(colW));
        });
        const hu = row.hu.padEnd(col);
        if (!allIn)
            missing++;
        console.log("  " + (allIn ? chalk_1.default.green(hu) : chalk_1.default.yellow(hu)) + cells.join(""));
    }
    console.log(chalk_1.default.dim("  " + "─".repeat(col + branches.length * 8)));
    if (missing === 0) {
        console.log(chalk_1.default.green.bold("\n  ✅ Todos los ambientes están homologados.\n"));
    }
    else {
        console.log(chalk_1.default.yellow(`\n  ⚠ ${missing} HU(s) no están completamente homologadas.`));
        console.log(chalk_1.default.dim(`  Usa ${chalk_1.default.bold("g66 sync")} para sincronizar.\n`));
    }
    if (data.ignore?.length) {
        console.log(chalk_1.default.dim(`  Archivos excluidos de sync: ${data.ignore.join(", ")}\n`));
    }
});
exports.default = envStatus;
