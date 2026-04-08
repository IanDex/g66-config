// imports existentes
import { Command } from "commander";
import inquirer from "inquirer";
import chalk from "chalk";
import { resolveConfigRepoPath } from "./config";
import { detectServiceInfo } from "./detect";
import { syncConfigFile } from "./sync";
import { revertConfig } from "./commands/revert";
import { ship } from "./commands/ship";
import { runInit } from "./commands/init";
import wl from "./commands/wl";


// 🔽 NUEVO
import pr from "./commands/pr";
import promote from "./commands/promote";

const program = new Command();

program
  .name("g66")
  .description("🛠️ CLI de herramientas para microservicios Global66")
  .version("1.0.0");

program
  .command("init")
  .description("🛠️ Configurar nombre del desarrollador y preferencias globales")
  .action(runInit);

program
  .command("config")
  .description("⚙️  Sincroniza archivos de configuración de entorno")
  .option("-p, --port <port>", "Sobrescribir port: 8080 si existe", parseInt)
  .action(async ({ port }) => {
    const cwd = process.cwd();
    const { serviceName, env, branch, baseBranch } = await detectServiceInfo(cwd);

    console.log(chalk.blue(`\n📍 Microservicio detectado: ${serviceName}`));
    console.log(chalk.blue(`🌿 Rama actual: ${branch}`));
    console.log(chalk.blue(`🔎 Rama base inferida: ${baseBranch}`));
    console.log(chalk.blue(`🌐 Entorno inferido: ${env}`));

    const configRepoPath = await resolveConfigRepoPath();

    console.log(chalk.blue(`📄 Archivo de configuración: ${serviceName}.yml`));
    console.log(chalk.blue(`📁 Repositorio de configuración: ${configRepoPath}`));
    console.log(chalk.blue(`📂 Ruta destino: src/main/resources/application-${env}.yml`));
    console.log(chalk.yellow(`\n🔧 El archivo será modificado:`));
    console.log("   • Reemplazo de lb-*-private → lb-*");
    console.log("   • Eliminación de token cifrado `{cipher}`");
    if (port) {
      console.log(`   • Reemplazo de 'port: 8080' → 'port: ${port}'`);
    }

    const { confirmed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmed",
        message: chalk.green("\n✅ ¿Deseas aplicar esta configuración ahora?"),
        default: true,
      },
    ]);

    if (!confirmed) {
      console.log(chalk.gray("🚫 Operación cancelada por el usuario."));
      return;
    }

    await syncConfigFile({ configRepoPath, serviceName, env, cwd, serverPort: port });
    console.log(chalk.green("\n🎉 ¡Archivo sincronizado correctamente!\n"));
  });


program
  .command("revert")
  .description("🔄 Revertir el archivo application.yml a su versión original del repositorio")
  .action(revertConfig);

program
  .command("ship")
  .description("🚢 Revertir configuración, aplicar spotless, commit y push en un solo paso")
  .action(ship);

// 🔽 NUEVO
program.addCommand(pr);
program.addCommand(promote);
program.addCommand(wl);

program.parse(process.argv);
