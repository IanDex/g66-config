import { Command } from "commander";
import { execSync } from "child_process";
import inquirer from "inquirer";
import chalk from "chalk";

const push = new Command("push")
  .description("📤 git add + commit + push en un solo paso")
  .option("-m, --message <msg>", "Mensaje del commit")
  .action(async (opts) => {
    // Obtener rama actual
    let branch = "";
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
    } catch {
      console.error(chalk.red("❌ No estás en un repositorio git."));
      process.exit(1);
    }

    // Pedir mensaje si no viene por flag
    let message: string = opts.message?.trim() || "";
    if (!message) {
      const ans = await inquirer.prompt([{
        type: "input", name: "message",
        message: "Mensaje del commit:",
        validate: (v: string) => v.trim().length > 0 || "El mensaje no puede estar vacío",
      }]);
      message = ans.message.trim();
    }

    try {
      console.log(chalk.dim("\n  → git add .\n"));
      execSync("git add .", { stdio: "inherit" });

      console.log(chalk.dim(`  → git commit -m "${message}"\n`));
      execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { stdio: "inherit" });

      console.log(chalk.dim(`  → git push --set-upstream origin ${branch}\n`));
      execSync(`git push --set-upstream origin ${branch}`, { stdio: "inherit" });

      console.log(chalk.green(`\n  ✅ Push completado → ${chalk.bold(branch)}\n`));
    } catch {
      process.exit(1);
    }
  });

export default push;
