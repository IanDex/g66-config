import { Command } from "commander";
import { spawnSync } from "child_process";
import inquirer from "inquirer";
import chalk from "chalk";
import * as path from "path";

const STATUS_SCRIPT = path.join(__dirname, "..", "..", "scripts", "env_status_context.py");
const SYNC_SCRIPT   = path.join(__dirname, "..", "..", "scripts", "sync_context.py");

function callScript(script: string, pyArgs: string[]): { data: any; ok: boolean } {
  const result = spawnSync("python", [script, ...pyArgs], {
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
  release:     "PROD (release)",
  master:      "CI   (master)",
  development: "DEV  (development)",
};

const BRANCHES = ["release", "master", "development"];

const sync = new Command("sync")
  .description("🔄 Sincroniza HUs entre ambientes con cherry-pick + spotless + push directo")
  .option("--dry-run", "Mostrar qué commits se aplicarían sin hacer cambios")
  .action(async (opts) => {
    const cwd = process.cwd();
    console.log(chalk.dim("\n  Cargando estado de ambientes...\n"));

    // ── 1. Cargar status ──────────────────────────────────────────────────
    const { data: statusData, ok: statusOk } = callScript(STATUS_SCRIPT, ["--cwd", cwd]);
    if (!statusOk || !statusData?.ok) {
      console.error(chalk.red("❌ No se pudo obtener el estado de los ambientes."));
      process.exit(1);
    }

    const matrix: any[]     = statusData.matrix  ?? [];
    const branches: string[] = statusData.branches ?? BRANCHES;

    // Mostrar tabla
    const col  = 12;
    const colW = 8;
    console.log(chalk.bold("  " + "HU".padEnd(col) +
      branches.map((b: string) => (BRANCH_LABEL[b]?.slice(0, 6) ?? b).padEnd(colW)).join("")));
    console.log(chalk.dim("  " + "─".repeat(col + branches.length * colW)));

    for (const row of matrix) {
      const allIn = branches.every((b: string) => row[b]);
      const cells = branches.map((b: string) => {
        const symbol = row[b] ? " ok  " : " --  ";
        return row[b] ? chalk.green(symbol.padEnd(colW)) : chalk.red(symbol.padEnd(colW));
      });
      const hu = row.hu.padEnd(col);
      console.log("  " + (allIn ? chalk.green(hu) : chalk.yellow(hu)) + cells.join(""));
    }
    console.log();

    // HUs no completamente homologadas
    const pendingHus = matrix.filter(r => !branches.every((b: string) => r[b]));
    if (!pendingHus.length) {
      console.log(chalk.green.bold("  ✅ Todos los ambientes ya están homologados.\n"));
      return;
    }

    // ── 2. Seleccionar source ─────────────────────────────────────────────
    const { source } = await inquirer.prompt([{
      type:    "list",
      name:    "source",
      message: "¿Desde qué ambiente tomar los cambios?",
      choices: branches.map(b => ({ name: BRANCH_LABEL[b] ?? b, value: b })),
    }]);

    // ── 3. Seleccionar target ─────────────────────────────────────────────
    const targetBranches = branches.filter(b => b !== source);
    const { target } = await inquirer.prompt([{
      type:    "list",
      name:    "target",
      message: "¿A qué ambiente aplicar los cambios?",
      choices: targetBranches.map(b => ({ name: BRANCH_LABEL[b] ?? b, value: b })),
    }]);

    // HUs que están en source pero NO en target
    const syncable = matrix.filter(r => r[source as string] && !r[target as string]);
    if (!syncable.length) {
      console.log(chalk.green(`\n  ✅ No hay HUs de ${source} que falten en ${target}.\n`));
      return;
    }

    // ── 4. Seleccionar HUs ────────────────────────────────────────────────
    const { selectedHus } = await inquirer.prompt([{
      type:    "checkbox",
      name:    "selectedHus",
      message: `¿Qué HUs sincronizar de ${BRANCH_LABEL[source as string] ?? source} → ${BRANCH_LABEL[target as string] ?? target}?`,
      choices: syncable.map(r => ({ name: r.hu, value: r.hu })),
      validate: (v: string[]) => v.length > 0 || "Selecciona al menos una HU",
    }]);

    // ── 5. Preview commits ────────────────────────────────────────────────
    console.log(chalk.dim("\n  Verificando commits...\n"));
    const { data: preview } = callScript(SYNC_SCRIPT, [
      "--cwd", cwd,
      "--source", source,
      "--target", target,
      "--hus", (selectedHus as string[]).join(","),
      "--dry-run",
    ]);

    if (preview?.commits?.length) {
      console.log(chalk.dim(`  Commits a aplicar (${preview.commits.length}):`));
      for (const c of preview.commits) {
        console.log(chalk.dim(`    ${chalk.yellow(c.sha)} ${c.msg.slice(0, 70)}`));
      }
      console.log();
    }

    if (preview?.ignore?.length) {
      console.log(chalk.dim(`  Archivos excluidos: ${preview.ignore.join(", ")}\n`));
    }

    // ── 6. Confirmar ──────────────────────────────────────────────────────
    const { confirm } = await inquirer.prompt([{
      type:    "list",
      name:    "confirm",
      message: `¿Aplicar ${(selectedHus as string[]).join(", ")} en ${target} con spotless y push directo?`,
      choices: [
        { name: "✅ Sí, sincronizar", value: "yes" },
        { name: "❌ Cancelar",        value: "no"  },
      ],
    }]);
    if (confirm !== "yes") {
      console.log(chalk.gray("\n🚫 Cancelado.\n"));
      return;
    }

    // ── 7. Ejecutar ───────────────────────────────────────────────────────
    const syncArgs = [
      "--cwd", cwd,
      "--source", source,
      "--target", target,
      "--hus", (selectedHus as string[]).join(","),
    ];
    if (opts.dryRun) syncArgs.push("--dry-run");

    console.log(chalk.dim("\n  Aplicando cambios...\n"));
    const { data: result, ok: syncOk } = callScript(SYNC_SCRIPT, syncArgs);

    if (!syncOk || !result?.ok) {
      console.error(chalk.red(`❌ ${result?.error ?? "Error al sincronizar."}`));
      if (result?.conflicts?.length) {
        console.log(chalk.yellow("\n  Conflictos:"));
        for (const c of result.conflicts) {
          console.log(chalk.red(`    ${c.sha} — ${c.error}`));
        }
      }
      process.exit(1);
    }

    console.log(chalk.green(`\n  ✅ ${result.applied?.length} commit(s) aplicados en ${target}`));
    for (const c of (result.applied ?? [])) {
      const restored = c.restored?.length ? chalk.dim(` (excluidos: ${c.restored.join(", ")})`) : "";
      console.log(chalk.dim(`    ${c.sha} ${c.msg.slice(0, 60)}${restored}`));
    }
    if (result.conflicts?.length) {
      console.log(chalk.yellow(`\n  ⚠ ${result.conflicts.length} commit(s) con conflicto — resolver manualmente:`));
      for (const c of result.conflicts) {
        console.log(chalk.red(`    ${c.sha} ${c.msg.slice(0, 60)}`));
      }
    }
    if (result.spotless === false) {
      console.log(chalk.yellow("  ⚠ Spotless falló — revisar antes de merge."));
    }
    console.log();
  });

export default sync;
