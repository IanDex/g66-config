"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// imports existentes
const commander_1 = require("commander");
const inquirer_1 = __importDefault(require("inquirer"));
const chalk_1 = __importDefault(require("chalk"));
const config_1 = require("./config");
const detect_1 = require("./detect");
const sync_1 = require("./sync");
const revert_1 = require("./commands/revert");
const ship_1 = require("./commands/ship");
const init_1 = require("./commands/init");
const wl_1 = __importDefault(require("./commands/wl"));
// 🔽 NUEVO
const pr_1 = __importDefault(require("./commands/pr"));
const promote_1 = __importDefault(require("./commands/promote"));
const sync_envs_1 = __importDefault(require("./commands/sync-envs"));
const program = new commander_1.Command();
program
    .name("g66")
    .description("🛠️ CLI de herramientas para microservicios Global66")
    .version("1.0.0");
program
    .command("init")
    .description("🛠️ Configurar nombre del desarrollador y preferencias globales")
    .action(init_1.runInit);
program
    .command("config")
    .description("⚙️  Sincroniza archivos de configuración de entorno")
    .option("-p, --port <port>", "Sobrescribir port: 8080 si existe", parseInt)
    .action(async ({ port }) => {
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
    if (port) {
        console.log(`   • Reemplazo de 'port: 8080' → 'port: ${port}'`);
    }
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
    await (0, sync_1.syncConfigFile)({ configRepoPath, serviceName, env, cwd, serverPort: port });
    console.log(chalk_1.default.green("\n🎉 ¡Archivo sincronizado correctamente!\n"));
});
program
    .command("revert")
    .description("🔄 Revertir el archivo application.yml a su versión original del repositorio")
    .action(revert_1.revertConfig);
program
    .command("ship")
    .description("🚢 Revertir configuración, aplicar spotless, commit y push en un solo paso")
    .action(ship_1.ship);
// 🔽 NUEVO
program.addCommand(pr_1.default);
program.addCommand(promote_1.default);
program.addCommand(sync_envs_1.default);
program.addCommand(wl_1.default);
program.parse(process.argv);
