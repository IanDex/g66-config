import { Command } from "commander";
import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface TokenRecord {
  ts:            string;
  command:       string;
  input_tokens:  number;
  output_tokens: number;
  total_tokens:  number;
}

function readLog(): TokenRecord[] {
  const logPath = path.join(os.homedir(), ".g66-tokens.jsonl");
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean) as TokenRecord[];
}

function fmt(n: number): string {
  return n.toLocaleString("es-CL");
}

const tokens = new Command("tokens")
  .description("🪙 Estadísticas de consumo de tokens por comando Claude")
  .option("--last <n>",  "Mostrar últimas N entradas", "20")
  .option("--clear",     "Borrar historial de tokens")
  .action((opts) => {
    const logPath = path.join(os.homedir(), ".g66-tokens.jsonl");

    if (opts.clear) {
      if (fs.existsSync(logPath)) {
        fs.unlinkSync(logPath);
        console.log(chalk.green("\n  ✅ Historial borrado.\n"));
      } else {
        console.log(chalk.dim("\n  Sin historial.\n"));
      }
      return;
    }

    const records = readLog();
    if (!records.length) {
      console.log(chalk.dim("\n  Sin registros aún. Usa g66 contract, g66 pr-smart, g66 migrate o g66 summary.\n"));
      return;
    }

    // Agregado por comando
    const byCmd: Record<string, { calls: number; input: number; output: number; total: number }> = {};
    for (const r of records) {
      if (!byCmd[r.command]) byCmd[r.command] = { calls: 0, input: 0, output: 0, total: 0 };
      byCmd[r.command].calls++;
      byCmd[r.command].input  += r.input_tokens  ?? 0;
      byCmd[r.command].output += r.output_tokens ?? 0;
      byCmd[r.command].total  += r.total_tokens  ?? 0;
    }

    console.log(chalk.bold("\n  Tokens consumidos por comando\n"));
    console.log(
      chalk.dim(
        "  " + "Comando".padEnd(14) + "Calls".padStart(6) +
        "Entrada".padStart(12) + "Salida".padStart(10) + "Total".padStart(10)
      )
    );
    console.log(chalk.dim("  " + "─".repeat(54)));

    let grandTotal = 0;
    for (const [cmd, s] of Object.entries(byCmd).sort((a, b) => b[1].total - a[1].total)) {
      grandTotal += s.total;
      console.log(
        "  " + chalk.cyan(cmd.padEnd(14)) +
        String(s.calls).padStart(6) +
        chalk.dim(fmt(s.input).padStart(12)) +
        chalk.dim(fmt(s.output).padStart(10)) +
        chalk.bold(fmt(s.total).padStart(10))
      );
    }
    console.log(chalk.dim("  " + "─".repeat(54)));
    console.log(
      "  " + "TOTAL".padEnd(14) +
      String(records.length).padStart(6) +
      "".padStart(22) +
      chalk.green.bold(fmt(grandTotal).padStart(10))
    );

    // Últimas N entradas
    const last = parseInt(opts.last, 10);
    const recent = records.slice(-last).reverse();
    console.log(chalk.bold(`\n  Últimas ${last} llamadas\n`));
    console.log(chalk.dim("  " + "Fecha".padEnd(22) + "Comando".padEnd(14) + "Total".padStart(8)));
    console.log(chalk.dim("  " + "─".repeat(46)));
    for (const r of recent) {
      const date = new Date(r.ts).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
      console.log(
        "  " + chalk.dim(date.padEnd(22)) +
        chalk.cyan(r.command.padEnd(14)) +
        chalk.bold(fmt(r.total_tokens ?? 0).padStart(8))
      );
    }
    console.log();
  });

export default tokens;
