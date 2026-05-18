import { Command } from "commander";
import { execSync } from "child_process";
import chalk from "chalk";

const ENV_BRANCH: Record<string, string> = {
  dev:  "development",
  ci:   "master",
  prod: "release",
};

const go = new Command("go")
  .description("🔀 Checkout rápido a rama base (dev/ci/prod)")
  .argument("<env>", "Ambiente: dev | ci | prod")
  .action((env: string) => {
    const target = ENV_BRANCH[env.toLowerCase()];
    if (!target) {
      console.error(chalk.red(`❌ Ambiente desconocido: '${env}'. Usar: dev | ci | prod`));
      process.exit(1);
    }
    try {
      console.log(chalk.dim(`\n  → git checkout ${target}\n`));
      execSync(`git checkout ${target}`, { stdio: "inherit" });
    } catch {
      process.exit(1);
    }
  });

export default go;
