import { Command } from "commander";
import { spawnSync } from "child_process";
import chalk from "chalk";
import * as path from "path";

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "jira_hu.py");

const STATUS_COLOR: Record<string, (s: string) => string> = {
  "In Progress":  chalk.blue,
  "Done":         chalk.green,
  "To Do":        chalk.gray,
  "Blocked":      chalk.red,
  "In Review":    chalk.yellow,
  "Closed":       chalk.green,
};

function colorStatus(s: string): string {
  const fn = STATUS_COLOR[s] ?? chalk.white;
  return fn(s);
}

const hu = new Command("hu")
  .description("📋 Muestra detalles de una HU de Jira")
  .argument("<hu>", "Código de la HU (ej: AT-108)")
  .action((huCode: string) => {
    const result = spawnSync("python", [SCRIPT, huCode], {
      encoding: "utf-8",
      stdio: ["inherit", "pipe", "inherit"],
    });

    if (!result.stdout?.trim()) {
      console.error(chalk.red("❌ Sin respuesta del script."));
      process.exit(1);
    }

    let data: any;
    try {
      data = JSON.parse(result.stdout.trim());
    } catch {
      console.error(chalk.red("❌ Respuesta inválida."));
      process.exit(1);
    }

    if (!data.ok) {
      console.error(chalk.red(`❌ ${data.error}`));
      process.exit(1);
    }

    console.log();
    console.log(chalk.bold.cyan(`📋 ${data.key} — ${data.title}`));
    console.log(`   Estado:    ${colorStatus(data.status)}`);
    console.log(`   Asignado:  ${chalk.white(data.assignee)}`);
    if (data.priority)      console.log(`   Prioridad: ${data.priority}`);
    if (data.story_points)  console.log(`   Puntos:    ${data.story_points}`);
    console.log(`   URL:       ${chalk.dim(data.url)}`);

    if (data.description) {
      console.log();
      console.log(chalk.bold("📝 Descripción:"));
      const lines = data.description.split("\n").slice(0, 15);
      lines.forEach((l: string) => console.log(chalk.dim("   " + l)));
      if (data.description.split("\n").length > 15) {
        console.log(chalk.dim("   [... ver URL para más]"));
      }
    }

    if (data.pr_links?.length) {
      console.log();
      console.log(chalk.bold("🔗 PRs vinculados:"));
      for (const pr of data.pr_links) {
        console.log(`   ${chalk.yellow(pr.env)}: ${chalk.dim(pr.url)}`);
      }
    }

    if (data.subtasks?.length) {
      console.log();
      console.log(chalk.bold("📌 Subtareas:"));
      for (const s of data.subtasks) {
        console.log(`   ${chalk.cyan(s.key)}  ${colorStatus(s.status)}  ${s.summary}`);
      }
    }

    if (data.issue_links?.length) {
      console.log();
      console.log(chalk.bold("🔀 HUs relacionadas:"));
      for (const l of data.issue_links) {
        console.log(`   ${chalk.dim(l.type)}  ${chalk.cyan(l.key)}  ${colorStatus(l.status)}  ${l.summary}`);
      }
    }

    console.log();
  });

export default hu;
