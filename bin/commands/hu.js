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
const SCRIPT = path.join(__dirname, "..", "..", "scripts", "jira_hu.py");
const STATUS_COLOR = {
    "In Progress": chalk_1.default.blue,
    "Done": chalk_1.default.green,
    "To Do": chalk_1.default.gray,
    "Blocked": chalk_1.default.red,
    "In Review": chalk_1.default.yellow,
    "Closed": chalk_1.default.green,
};
function colorStatus(s) {
    const fn = STATUS_COLOR[s] ?? chalk_1.default.white;
    return fn(s);
}
const hu = new commander_1.Command("hu")
    .description("📋 Muestra detalles de una HU de Jira")
    .argument("<hu>", "Código de la HU (ej: AT-108)")
    .action((huCode) => {
    const result = (0, child_process_1.spawnSync)("python", [SCRIPT, huCode], {
        encoding: "utf-8",
        stdio: ["inherit", "pipe", "inherit"],
    });
    if (!result.stdout?.trim()) {
        console.error(chalk_1.default.red("❌ Sin respuesta del script."));
        process.exit(1);
    }
    let data;
    try {
        data = JSON.parse(result.stdout.trim());
    }
    catch {
        console.error(chalk_1.default.red("❌ Respuesta inválida."));
        process.exit(1);
    }
    if (!data.ok) {
        console.error(chalk_1.default.red(`❌ ${data.error}`));
        process.exit(1);
    }
    console.log();
    console.log(chalk_1.default.bold.cyan(`📋 ${data.key} — ${data.title}`));
    console.log(`   Estado:    ${colorStatus(data.status)}`);
    console.log(`   Asignado:  ${chalk_1.default.white(data.assignee)}`);
    if (data.priority)
        console.log(`   Prioridad: ${data.priority}`);
    if (data.story_points)
        console.log(`   Puntos:    ${data.story_points}`);
    console.log(`   URL:       ${chalk_1.default.dim(data.url)}`);
    if (data.description) {
        console.log();
        console.log(chalk_1.default.bold("📝 Descripción:"));
        const lines = data.description.split("\n").slice(0, 15);
        lines.forEach((l) => console.log(chalk_1.default.dim("   " + l)));
        if (data.description.split("\n").length > 15) {
            console.log(chalk_1.default.dim("   [... ver URL para más]"));
        }
    }
    if (data.pr_links?.length) {
        console.log();
        console.log(chalk_1.default.bold("🔗 PRs vinculados:"));
        for (const pr of data.pr_links) {
            console.log(`   ${chalk_1.default.yellow(pr.env)}: ${chalk_1.default.dim(pr.url)}`);
        }
    }
    if (data.subtasks?.length) {
        console.log();
        console.log(chalk_1.default.bold("📌 Subtareas:"));
        for (const s of data.subtasks) {
            console.log(`   ${chalk_1.default.cyan(s.key)}  ${colorStatus(s.status)}  ${s.summary}`);
        }
    }
    if (data.issue_links?.length) {
        console.log();
        console.log(chalk_1.default.bold("🔀 HUs relacionadas:"));
        for (const l of data.issue_links) {
            console.log(`   ${chalk_1.default.dim(l.type)}  ${chalk_1.default.cyan(l.key)}  ${colorStatus(l.status)}  ${l.summary}`);
        }
    }
    console.log();
});
exports.default = hu;
