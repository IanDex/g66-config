import { Command } from "commander";
import { spawnSync } from "child_process";
import chalk from "chalk";
import * as path from "path";

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "env_status_context.py");

function callScript(pyArgs: string[]): { data: any; ok: boolean } {
  const result = spawnSync("python", [SCRIPT, ...pyArgs], {
    encoding: "utf-8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  const raw = result.stdout?.trim() || result.stderr?.trim();
  if (!raw) return { data: null, ok: false };
  try {
    const data = JSON.parse(raw);
    return { data, ok: !!data };
  } catch {
    return { data: null, ok: false };
  }
}

const BRANCH_LABEL: Record<string, string> = {
  release:     "PROD",
  master:      "CI  ",
  development: "DEV ",
};

const envStatus = new Command("env-status")
  .description("📊 Muestra qué HUs están en PROD / CI / DEV")
  .action(() => {
    const cwd = process.cwd();
    console.log(chalk.dim("\n  Consultando ramas (fetch)...\n"));

    const { data, ok } = callScript(["--cwd", cwd]);
    if (!ok || !data?.ok) {
      console.error(chalk.red("❌ Error al obtener el estado de los ambientes."));
      process.exit(1);
    }

    const matrix: any[]  = data.matrix  ?? [];
    const branches: string[] = data.branches ?? ["release", "master", "development"];

    // Header
    const col = 12;
    const colW = 8;
    const header = "  " + "HU".padEnd(col) +
      branches.map((b: string) => (BRANCH_LABEL[b] ?? b).padEnd(colW)).join("");
    console.log(chalk.bold(header));
    console.log(chalk.dim("  " + "─".repeat(col + branches.length * colW)));

    let missing = 0;
    for (const row of matrix) {
      const states = branches.map((b: string) => row[b]);
      const allIn  = states.every(Boolean);
      const noneIn = states.every((s: boolean) => !s);

      if (noneIn) continue;

      const cells = branches.map((b: string) => {
        const val: boolean = row[b];
        const symbol = val ? " ok  " : " --  ";   // mismo ancho siempre
        return val ? chalk.green(symbol.padEnd(colW)) : chalk.red(symbol.padEnd(colW));
      });

      const hu = row.hu.padEnd(col);
      if (!allIn) missing++;

      console.log("  " + (allIn ? chalk.green(hu) : chalk.yellow(hu)) + cells.join(""));
    }

    console.log(chalk.dim("  " + "─".repeat(col + branches.length * 8)));

    if (missing === 0) {
      console.log(chalk.green.bold("\n  ✅ Todos los ambientes están homologados.\n"));
    } else {
      console.log(chalk.yellow(`\n  ⚠ ${missing} HU(s) no están completamente homologadas.`));
      console.log(chalk.dim(`  Usa ${chalk.bold("g66 sync")} para sincronizar.\n`));
    }

    if (data.ignore?.length) {
      console.log(chalk.dim(`  Archivos excluidos de sync: ${data.ignore.join(", ")}\n`));
    }
  });

export default envStatus;
