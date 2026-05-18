import { Command } from "commander";
import chalk from "chalk";
import { runPrAnalyze } from "../services/pr-analyze.service";

const prAnalyze = new Command("pr-analyze");

prAnalyze
  .description(
    "Lee un PR en CodeCommit y comprueba si los commits del PR están ya en development y en master (CI)",
  )
  .argument("<id>", "ID del pull request (ej. 71109)")
  .action(async (id: string) => {
    const trimmed = id.trim().replace(/^#/, "");
    if (!/^\d+$/.test(trimmed)) {
      console.error(chalk.red("El ID del PR debe ser numérico."));
      process.exitCode = 1;
      return;
    }
    try {
      await runPrAnalyze(process.cwd(), trimmed);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(chalk.red(`\n${msg}\n`));
      process.exitCode = 1;
    }
  });

export default prAnalyze;
