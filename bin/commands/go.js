"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const child_process_1 = require("child_process");
const chalk_1 = __importDefault(require("chalk"));
const ENV_BRANCH = {
    dev: "development",
    ci: "master",
    prod: "release",
};
const go = new commander_1.Command("go")
    .description("🔀 Checkout rápido a rama base (dev/ci/prod)")
    .argument("<env>", "Ambiente: dev | ci | prod")
    .action((env) => {
    const target = ENV_BRANCH[env.toLowerCase()];
    if (!target) {
        console.error(chalk_1.default.red(`❌ Ambiente desconocido: '${env}'. Usar: dev | ci | prod`));
        process.exit(1);
    }
    try {
        console.log(chalk_1.default.dim(`\n  → git checkout ${target}\n`));
        (0, child_process_1.execSync)(`git checkout ${target}`, { stdio: "inherit" });
    }
    catch {
        process.exit(1);
    }
});
exports.default = go;
