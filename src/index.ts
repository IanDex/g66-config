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
import syncEnvs from "./commands/sync-envs";
import prAnalyze from "./commands/pr-analyze";
import token from "./commands/token";
import company from "./commands/company";
import status from "./commands/status";
import prSmart from "./commands/pr-smart";
import apigw from "./commands/apigw";
import prReview from "./commands/pr-review";
import setup from "./commands/setup";
import hu from "./commands/hu";
import start from "./commands/start";
import test from "./commands/test";
import liquibase from "./commands/liquibase";
import doctor from "./commands/doctor";
import release from "./commands/release";
import props from "./commands/props";
import contract from "./commands/contract";
import hotfix from "./commands/hotfix";
import migrate from "./commands/migrate";
import summary from "./commands/summary";
import tokens from "./commands/tokens";
import envStatus from "./commands/env-status";
import sync from "./commands/sync";
import slack from "./commands/slack";
import go from "./commands/go";
import nb from "./commands/nb";
import undo from "./commands/undo";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version: CLI_VERSION } = require("../package.json");
const program = new Command();

program
  .name("g66")
  .description("🛠️ CLI de herramientas para microservicios Global66")
  .version(CLI_VERSION);

program.hook("preAction", (_thisCommand, actionCommand) => {
  const commandName = actionCommand.name();
  console.log(chalk.cyan(`\n🚀 g66 v${CLI_VERSION} | comando: ${commandName}\n`));
});

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
program.addCommand(syncEnvs);
program.addCommand(prAnalyze);
program.addCommand(wl);
program.addCommand(token);
program.addCommand(company);
program.addCommand(status);
program.addCommand(prSmart);
program.addCommand(apigw);
program.addCommand(prReview);
program.addCommand(setup);
program.addCommand(hu);
program.addCommand(start);
program.addCommand(test);
program.addCommand(liquibase);
program.addCommand(doctor);
program.addCommand(release);
program.addCommand(props);
program.addCommand(contract);
program.addCommand(hotfix);
program.addCommand(migrate);
program.addCommand(summary);
program.addCommand(tokens);
program.addCommand(envStatus);
program.addCommand(sync);
program.addCommand(slack);
program.addCommand(go);
program.addCommand(nb);
program.addCommand(undo);

program.parse(process.argv);
