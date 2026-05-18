import { Command } from "commander";
import { execSync } from "child_process";
import inquirer from "inquirer";
import chalk from "chalk";

const undo = new Command("undo")
  .description("⏪ git reset --hard HEAD^ (deshace el último commit)")
  .action(async () => {
    // Mostrar qué commit se va a deshacer
    let lastCommit = "";
    try {
      lastCommit = execSync("git log --oneline -1", { encoding: "utf-8" }).trim();
    } catch {
      console.error(chalk.red("❌ No estás en un repositorio git."));
      process.exit(1);
    }

    console.log(chalk.yellow(`\n  ⚠️  Esto deshará el commit:\n  ${chalk.bold(lastCommit)}\n`));
    console.log(chalk.red("  Los cambios se perderán permanentemente.\n"));

    const { confirmed } = await inquirer.prompt([{
      type: "confirm",
      name: "confirmed",
      message: "¿Continuar?",
      default: false,
    }]);

    if (!confirmed) {
      console.log(chalk.gray("\n  Cancelado.\n"));
      return;
    }

    try {
      execSync("git reset --hard HEAD^", { stdio: "inherit" });
      console.log(chalk.green("\n  ✅ Commit deshecho.\n"));
    } catch {
      process.exit(1);
    }
  });

export default undo;
