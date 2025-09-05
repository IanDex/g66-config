#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const config_1 = require("./config");
const detect_1 = require("./detect");
const sync_1 = require("./sync");
const inquirer_1 = __importDefault(require("inquirer"));
const chalk_1 = __importDefault(require("chalk"));
const program = new commander_1.Command();
program
    .name("g66-config")
    .description("Sincroniza archivos de configuración para microservicios Global66")
    .version("1.0.0");
program.action(async () => {
    const cwd = process.cwd();
    const { serviceName, env, branch, baseBranch } = await (0, detect_1.detectServiceInfo)(cwd);
    console.log(chalk_1.default.blue(`\n📍 Microservicio detectado: ${serviceName}`));
    console.log(chalk_1.default.blue(`🌿 Rama actual: ${branch}`));
    console.log(chalk_1.default.blue(`🔎 Rama base inferida: ${baseBranch}`));
    console.log(chalk_1.default.blue(`🌐 Entorno inferido: ${env}`));
    const configRepoPath = await (0, config_1.resolveConfigRepoPath)();
    console.log(chalk_1.default.blue(`📄 Archivo de configuración: ${serviceName}.yml`));
    console.log(chalk_1.default.blue(`📁 Repositorio de configuración: ${configRepoPath}`));
    console.log(chalk_1.default.blue(`📂 Ruta destino: src/main/resources/application-${env}.yml`));
    console.log(chalk_1.default.yellow(`\n🔧 El archivo será modificado:`));
    console.log("   • Reemplazo de lb-*-private → lb-*");
    console.log("   • Eliminación de token cifrado `{cipher}`");
    const { confirmed } = await inquirer_1.default.prompt([
        {
            type: "confirm",
            name: "confirmed",
            message: chalk_1.default.green("\n✅ ¿Deseas aplicar esta configuración ahora?"),
            default: true,
        },
    ]);
    if (!confirmed) {
        console.log(chalk_1.default.gray("🚫 Operación cancelada por el usuario."));
        return;
    }
    await (0, sync_1.syncConfigFile)({ configRepoPath, serviceName, env, cwd });
    console.log(chalk_1.default.green("\n🎉 ¡Archivo sincronizado correctamente!\n"));
});
program.parse(process.argv);
