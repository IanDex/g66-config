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
const chalk_1 = __importDefault(require("chalk"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
function readLog() {
    const logPath = path.join(os.homedir(), ".g66-tokens.jsonl");
    if (!fs.existsSync(logPath))
        return [];
    return fs.readFileSync(logPath, "utf-8")
        .split("\n")
        .filter(Boolean)
        .map(line => { try {
        return JSON.parse(line);
    }
    catch {
        return null;
    } })
        .filter(Boolean);
}
function fmt(n) {
    return n.toLocaleString("es-CL");
}
const tokens = new commander_1.Command("tokens")
    .description("🪙 Estadísticas de consumo de tokens por comando Claude")
    .option("--last <n>", "Mostrar últimas N entradas", "20")
    .option("--clear", "Borrar historial de tokens")
    .action((opts) => {
    const logPath = path.join(os.homedir(), ".g66-tokens.jsonl");
    if (opts.clear) {
        if (fs.existsSync(logPath)) {
            fs.unlinkSync(logPath);
            console.log(chalk_1.default.green("\n  ✅ Historial borrado.\n"));
        }
        else {
            console.log(chalk_1.default.dim("\n  Sin historial.\n"));
        }
        return;
    }
    const records = readLog();
    if (!records.length) {
        console.log(chalk_1.default.dim("\n  Sin registros aún. Usa g66 contract, g66 pr-smart, g66 migrate o g66 summary.\n"));
        return;
    }
    // Agregado por comando
    const byCmd = {};
    for (const r of records) {
        if (!byCmd[r.command])
            byCmd[r.command] = { calls: 0, input: 0, output: 0, total: 0 };
        byCmd[r.command].calls++;
        byCmd[r.command].input += r.input_tokens ?? 0;
        byCmd[r.command].output += r.output_tokens ?? 0;
        byCmd[r.command].total += r.total_tokens ?? 0;
    }
    console.log(chalk_1.default.bold("\n  Tokens consumidos por comando\n"));
    console.log(chalk_1.default.dim("  " + "Comando".padEnd(14) + "Calls".padStart(6) +
        "Entrada".padStart(12) + "Salida".padStart(10) + "Total".padStart(10)));
    console.log(chalk_1.default.dim("  " + "─".repeat(54)));
    let grandTotal = 0;
    for (const [cmd, s] of Object.entries(byCmd).sort((a, b) => b[1].total - a[1].total)) {
        grandTotal += s.total;
        console.log("  " + chalk_1.default.cyan(cmd.padEnd(14)) +
            String(s.calls).padStart(6) +
            chalk_1.default.dim(fmt(s.input).padStart(12)) +
            chalk_1.default.dim(fmt(s.output).padStart(10)) +
            chalk_1.default.bold(fmt(s.total).padStart(10)));
    }
    console.log(chalk_1.default.dim("  " + "─".repeat(54)));
    console.log("  " + "TOTAL".padEnd(14) +
        String(records.length).padStart(6) +
        "".padStart(22) +
        chalk_1.default.green.bold(fmt(grandTotal).padStart(10)));
    // Últimas N entradas
    const last = parseInt(opts.last, 10);
    const recent = records.slice(-last).reverse();
    console.log(chalk_1.default.bold(`\n  Últimas ${last} llamadas\n`));
    console.log(chalk_1.default.dim("  " + "Fecha".padEnd(22) + "Comando".padEnd(14) + "Total".padStart(8)));
    console.log(chalk_1.default.dim("  " + "─".repeat(46)));
    for (const r of recent) {
        const date = new Date(r.ts).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
        console.log("  " + chalk_1.default.dim(date.padEnd(22)) +
            chalk_1.default.cyan(r.command.padEnd(14)) +
            chalk_1.default.bold(fmt(r.total_tokens ?? 0).padStart(8)));
    }
    console.log();
});
exports.default = tokens;
