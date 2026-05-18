"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const child_process_1 = require("child_process");
const inquirer_1 = __importDefault(require("inquirer"));
const chalk_1 = __importDefault(require("chalk"));
const undo = new commander_1.Command("undo")
    .description("⏪ git reset --hard HEAD^ (deshace el último commit)")
    .action(async () => {
    // Mostrar qué commit se va a deshacer
    let lastCommit = "";
    try {
        lastCommit = (0, child_process_1.execSync)("git log --oneline -1", { encoding: "utf-8" }).trim();
    }
    catch {
        console.error(chalk_1.default.red("❌ No estás en un repositorio git."));
        process.exit(1);
    }
    console.log(chalk_1.default.yellow(`\n  ⚠️  Esto deshará el commit:\n  ${chalk_1.default.bold(lastCommit)}\n`));
    console.log(chalk_1.default.red("  Los cambios se perderán permanentemente.\n"));
    const { confirmed } = await inquirer_1.default.prompt([{
            type: "confirm",
            name: "confirmed",
            message: "¿Continuar?",
            default: false,
        }]);
    if (!confirmed) {
        console.log(chalk_1.default.gray("\n  Cancelado.\n"));
        return;
    }
    try {
        (0, child_process_1.execSync)("git reset --hard HEAD^", { stdio: "inherit" });
        console.log(chalk_1.default.green("\n  ✅ Commit deshecho.\n"));
    }
    catch {
        process.exit(1);
    }
});
exports.default = undo;
