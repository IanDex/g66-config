import { Command } from "commander";
import { spawnSync, execSync } from "child_process";
import inquirer from "inquirer";
import chalk from "chalk";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "setup_logi.py");
const DEFAULT_CONFIG_PROPS = path.join(os.homedir(), "Documents", "ms-g66", "ms-config-properties");

const setup = new Command("setup")
  .description("⚙️  Genera config de logi leyendo credenciales de ms-config-properties")
  .option("--repo <path>",    "Ruta a ms-config-properties")
  .option("--service <name>", "Servicio a parsear", "company")
  .option("--dry-run",        "Mostrar config generada sin escribir")
  .action(async (opts) => {
    let repo: string = opts.repo;

    if (!repo) {
      if (fs.existsSync(DEFAULT_CONFIG_PROPS)) {
        repo = DEFAULT_CONFIG_PROPS;
      } else {
        const { inputRepo } = await inquirer.prompt([{
          type: "input",
          name: "inputRepo",
          message: "📁 Ruta local a ms-config-properties:",
          validate: (v: string) => {
            if (!v.trim()) return "Requerido";
            if (!fs.existsSync(v.trim())) return `No existe: ${v.trim()}`;
            return true;
          },
        }]);
        repo = inputRepo.trim();
      }
    }

    console.log(chalk.blue(`\n🔧 Leyendo credenciales desde:\n   ${repo}\n`));

    const pyArgs = ["--repo", repo, "--service", opts.service];
    if (opts.dryRun) pyArgs.push("--dry-run");

    const result = spawnSync("python", [SCRIPT, ...pyArgs], {
      encoding: "utf-8",
      stdio: ["inherit", "pipe", "inherit"],
    });

    if (!result.stdout?.trim()) {
      console.error(chalk.red("❌ El script no retornó respuesta."));
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

    if (opts.dryRun) {
      console.log(chalk.yellow("\n[dry-run] Config que se generaría:\n"));
      console.log(chalk.dim(data.preview));
      return;
    }

    console.log(chalk.green(`✅ config.py generado en:\n   ${data.path}\n`));
    console.log(chalk.dim("  g66 token  →  listo para usar"));
  });

export default setup;
