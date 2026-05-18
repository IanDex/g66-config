import { Command } from "commander";
import { spawnSync, spawn, execSync } from "child_process";
import chalk from "chalk";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "liquibase_context.py");

const liquibase = new Command("liquibase")
  .description("🗄️  Detecta cambios en entidades JPA y genera changeset Liquibase con Claude")
  .option("--hu <hu>",  "Código HU (ej: AT-108); se infiere de la rama si no se pasa")
  .option("--print",    "Solo imprimir el prompt sin lanzar Claude")
  .action((opts) => {
    const cwd = process.cwd();
    console.log(chalk.dim(`\n  Analizando cambios en entidades JPA en ${path.basename(cwd)}...`));

    const pyArgs = ["--cwd", cwd];
    if (opts.hu) pyArgs.push("--hu", opts.hu);

    const result = spawnSync("python", [SCRIPT, ...pyArgs], {
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

    console.log(chalk.green(`✅ Repo: ${data.repo}`));
    if (data.hu)     console.log(chalk.blue(`   HU:     ${data.hu}`));
    if (data.schema) console.log(chalk.cyan(`   Schema: ${data.schema}`));
    console.log(chalk.yellow(`   Entidades con cambios:`));
    for (const f of data.entity_files ?? []) {
      console.log(chalk.dim(`     • ${f}`));
    }
    console.log();

    if (opts.print) {
      console.log(data.prompt);
      return;
    }

    const tmpFile = path.join(os.tmpdir(), `g66-liquibase-${data.repo}.md`);
    fs.writeFileSync(tmpFile, data.prompt, "utf-8");

    try {
      execSync(`clip < "${tmpFile}"`, { shell: "cmd.exe" });
    } catch {
      try {
        execSync(`powershell -Command "Get-Content '${tmpFile}' | Set-Clipboard"`);
      } catch { /* silencioso */ }
    }

    console.log(chalk.cyan("📋 Prompt copiado al clipboard\n"));
    console.log(chalk.bold("🤖 Lanzando Claude — pegá el prompt con ") + chalk.bold.yellow("Ctrl+V") + chalk.bold(" y Enter\n"));

    const claude = spawn("claude", [], {
      stdio: "inherit",
      shell: false,
    });

    claude.on("error", (err) => {
      console.error(chalk.red(`❌ No se pudo lanzar Claude: ${err.message}`));
      console.log(chalk.yellow("💡 Instala Claude Code: npm install -g @anthropic-ai/claude-code"));
      console.log(chalk.dim(`\n📄 Prompt guardado en: ${tmpFile}`));
      process.exit(1);
    });

    claude.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  });

export default liquibase;
