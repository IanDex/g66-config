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
const pr_analyze_1 = __importDefault(require("./commands/pr-analyze"));
const token_1 = __importDefault(require("./commands/token"));
const company_1 = __importDefault(require("./commands/company"));
const status_1 = __importDefault(require("./commands/status"));
const pr_smart_1 = __importDefault(require("./commands/pr-smart"));
const apigw_1 = __importDefault(require("./commands/apigw"));
const pr_review_1 = __importDefault(require("./commands/pr-review"));
const setup_1 = __importDefault(require("./commands/setup"));
const hu_1 = __importDefault(require("./commands/hu"));
const start_1 = __importDefault(require("./commands/start"));
const test_1 = __importDefault(require("./commands/test"));
const liquibase_1 = __importDefault(require("./commands/liquibase"));
const doctor_1 = __importDefault(require("./commands/doctor"));
const release_1 = __importDefault(require("./commands/release"));
const props_1 = __importDefault(require("./commands/props"));
const contract_1 = __importDefault(require("./commands/contract"));
const hotfix_1 = __importDefault(require("./commands/hotfix"));
const migrate_1 = __importDefault(require("./commands/migrate"));
const summary_1 = __importDefault(require("./commands/summary"));
const tokens_1 = __importDefault(require("./commands/tokens"));
const env_status_1 = __importDefault(require("./commands/env-status"));
const sync_2 = __importDefault(require("./commands/sync"));
const slack_1 = __importDefault(require("./commands/slack"));
const go_1 = __importDefault(require("./commands/go"));
const nb_1 = __importDefault(require("./commands/nb"));
const undo_1 = __importDefault(require("./commands/undo"));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version: CLI_VERSION } = require("../package.json");
const program = new commander_1.Command();
program
    .name("g66")
    .description("🛠️ CLI de herramientas para microservicios Global66")
    .version(CLI_VERSION);
program.hook("preAction", (_thisCommand, actionCommand) => {
    const commandName = actionCommand.name();
    console.log(chalk_1.default.cyan(`\n🚀 g66 v${CLI_VERSION} | comando: ${commandName}\n`));
});
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
program.addCommand(pr_analyze_1.default);
program.addCommand(wl_1.default);
program.addCommand(token_1.default);
program.addCommand(company_1.default);
program.addCommand(status_1.default);
program.addCommand(pr_smart_1.default);
program.addCommand(apigw_1.default);
program.addCommand(pr_review_1.default);
program.addCommand(setup_1.default);
program.addCommand(hu_1.default);
program.addCommand(start_1.default);
program.addCommand(test_1.default);
program.addCommand(liquibase_1.default);
program.addCommand(doctor_1.default);
program.addCommand(release_1.default);
program.addCommand(props_1.default);
program.addCommand(contract_1.default);
program.addCommand(hotfix_1.default);
program.addCommand(migrate_1.default);
program.addCommand(summary_1.default);
program.addCommand(tokens_1.default);
program.addCommand(env_status_1.default);
program.addCommand(sync_2.default);
program.addCommand(slack_1.default);
program.addCommand(go_1.default);
program.addCommand(nb_1.default);
program.addCommand(undo_1.default);
program.parse(process.argv);
