#!/usr/bin/env node

import { Command } from "commander";
import { resolveConfigRepoPath } from "./config";
import { detectServiceInfo } from "./detect";
import { syncConfigFile } from "./sync";
import inquirer from "inquirer";
import chalk from "chalk";

const program = new Command();

program
  .name("g66-config")
  .description("Sincroniza archivos de configuración para microservicios Global66")
  .version("1.0.0");

program.action(async () => {
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

  await syncConfigFile({ configRepoPath, serviceName, env, cwd });
  console.log(chalk.green("\n🎉 ¡Archivo sincronizado correctamente!\n"));
});

program.parse(process.argv);
