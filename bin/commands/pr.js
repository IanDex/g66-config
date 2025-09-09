"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const git_utils_1 = require("../utils/git-utils");
const config_utils_1 = require("../utils/config-utils");
const pr_prompts_1 = require("../prompts/pr-prompts");
const pr_template_1 = require("../templates/pr-template");
const codecommit_service_1 = require("../services/codecommit-service");
const pr = new commander_1.Command("pr");
pr
    .description("📤 Crear un Pull Request en AWS CodeCommit usando plantilla")
    .action(async () => {
    try {
        const branch = (0, git_utils_1.getCurrentBranch)();
        const repo = (0, git_utils_1.getRepoName)();
        const env = (0, git_utils_1.inferEnvironment)(branch);
        const baseBranch = env === "ci" ? "master" : "development";
        console.log(chalk_1.default.blue(`\n🌿 Rama actual: ${branch}`));
        console.log(chalk_1.default.blue(`📦 Repositorio: ${repo}`));
        console.log(chalk_1.default.blue(`🌐 Entorno inferido: ${env}`));
        // 🔒 Validar si la rama fue pusheada
        if (!(0, git_utils_1.isBranchPushed)(branch)) {
            console.log(chalk_1.default.red(`\n🚫 La rama '${branch}' no existe en remoto. Hacé 'git push' primero.\n`));
            return;
        }
        // 🧼 Validar si hay commits para hacer PR
        if (!(0, git_utils_1.hasCommitsToPush)(baseBranch)) {
            console.log(chalk_1.default.red(`\n🚫 No hay commits nuevos respecto a 'origin/${baseBranch}'. No se puede crear el PR.\n`));
            return;
        }
        // 👤 Obtener datos del dev
        const devConfig = (0, config_utils_1.getDeveloperConfig)();
        // 📝 Pedir datos del PR
        const prData = await (0, pr_prompts_1.promptPrData)(devConfig);
        // 🧱 Construir cuerpo del PR
        const prBody = (0, pr_template_1.buildPrTemplate)({
            ...prData,
            developer: devConfig.author,
            branch,
            environment: env,
        });
        // 🚀 Crear el PR en CodeCommit
        await (0, codecommit_service_1.createPullRequest)({
            repositoryName: repo,
            sourceBranch: branch,
            destinationBranch: baseBranch,
            title: `[${prData.jira}] ${prData.title}`,
            description: prBody,
        });
    }
    catch (err) {
        console.error(chalk_1.default.red(`\n❌ Error al crear el PR:`), err.message || err);
    }
});
exports.default = pr;
