import { Command } from "commander";
import chalk from "chalk";
import { getCurrentBranch, getRepoName, inferEnvironment, isBranchPushed, hasCommitsToPush } from "../utils/git-utils";
import { getDeveloperConfig } from "../utils/config-utils";
import { promptPrData } from "../prompts/pr-prompts";
import { buildPrTemplate } from "../templates/pr-template";
import { createPullRequest } from "../services/codecommit-service";

const pr = new Command("pr");

pr
  .description("📤 Crear un Pull Request en AWS CodeCommit usando plantilla")
  .action(async () => {
    try {
      const branch = getCurrentBranch();
      const repo = getRepoName();
      const env = inferEnvironment(branch);
      const baseBranch = env === "ci" ? "master" : "development";

      console.log(chalk.blue(`\n🌿 Rama actual: ${branch}`));
      console.log(chalk.blue(`📦 Repositorio: ${repo}`));
      console.log(chalk.blue(`🌐 Entorno inferido: ${env}`));

      // 🔒 Validar si la rama fue pusheada
      if (!isBranchPushed(branch)) {
        console.log(chalk.red(`\n🚫 La rama '${branch}' no existe en remoto. Hacé 'git push' primero.\n`));
        return;
      }

      // 🧼 Validar si hay commits para hacer PR
      if (!hasCommitsToPush(baseBranch)) {
        console.log(chalk.red(`\n🚫 No hay commits nuevos respecto a 'origin/${baseBranch}'. No se puede crear el PR.\n`));
        return;
      }

      // 👤 Obtener datos del dev
      const devConfig = getDeveloperConfig();

      // 📝 Pedir datos del PR
      const prData = await promptPrData(devConfig);

      // 🧱 Construir cuerpo del PR
      const prBody = buildPrTemplate({
        ...prData,
        developer: devConfig.author,
        branch,
        environment: env,
      });

      // 🚀 Crear el PR en CodeCommit
      await createPullRequest({
        repositoryName: repo,
        sourceBranch: branch,
        destinationBranch: baseBranch,
        title: `[${prData.jira}] ${prData.title}`,
        description: prBody,
      });
    } catch (err: any) {
      console.error(chalk.red(`\n❌ Error al crear el PR:`), err.message || err);
    }
  });

export default pr;
