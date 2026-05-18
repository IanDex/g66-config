"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const child_process_1 = require("child_process");
const inquirer_1 = __importDefault(require("inquirer"));
const chalk_1 = __importDefault(require("chalk"));
const push = new commander_1.Command("push")
    .description("📤 git add + commit + push en un solo paso")
    .option("-m, --message <msg>", "Mensaje del commit")
    .action(async (opts) => {
    // Obtener rama actual
    let branch = "";
    try {
        branch = (0, child_process_1.execSync)("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
    }
    catch {
        console.error(chalk_1.default.red("❌ No estás en un repositorio git."));
        process.exit(1);
    }
    // Pedir mensaje si no viene por flag
    let message = opts.message?.trim() || "";
    if (!message) {
        const ans = await inquirer_1.default.prompt([{
                type: "input", name: "message",
                message: "Mensaje del commit:",
                validate: (v) => v.trim().length > 0 || "El mensaje no puede estar vacío",
            }]);
        message = ans.message.trim();
    }
    try {
        console.log(chalk_1.default.dim("\n  → git add .\n"));
        (0, child_process_1.execSync)("git add .", { stdio: "inherit" });
        console.log(chalk_1.default.dim(`  → git commit -m "${message}"\n`));
        (0, child_process_1.execSync)(`git commit -m "${message.replace(/"/g, '\\"')}"`, { stdio: "inherit" });
        console.log(chalk_1.default.dim(`  → git push --set-upstream origin ${branch}\n`));
        (0, child_process_1.execSync)(`git push --set-upstream origin ${branch}`, { stdio: "inherit" });
        console.log(chalk_1.default.green(`\n  ✅ Push completado → ${chalk_1.default.bold(branch)}\n`));
    }
    catch {
        process.exit(1);
    }
});
exports.default = push;
