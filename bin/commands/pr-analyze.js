"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const pr_analyze_service_1 = require("../services/pr-analyze.service");
const prAnalyze = new commander_1.Command("pr-analyze");
prAnalyze
    .description("Lee un PR en CodeCommit y comprueba si los commits del PR están ya en development y en master (CI)")
    .argument("<id>", "ID del pull request (ej. 71109)")
    .action(async (id) => {
    const trimmed = id.trim().replace(/^#/, "");
    if (!/^\d+$/.test(trimmed)) {
        console.error(chalk_1.default.red("El ID del PR debe ser numérico."));
        process.exitCode = 1;
        return;
    }
    try {
        await (0, pr_analyze_service_1.runPrAnalyze)(process.cwd(), trimmed);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(chalk_1.default.red(`\n${msg}\n`));
        process.exitCode = 1;
    }
});
exports.default = prAnalyze;
