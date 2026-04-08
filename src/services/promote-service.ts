import chalk from "chalk";
import { createGitService } from "./git-service";
import { promptPromote, type PromotePromptAnswers } from "../prompts/promote-prompts";
import { isDirectPushForbiddenBranch } from "../utils/promote-constants";

export interface RunPromoteOptions {
  dryRun: boolean;
}

const log = {
  step: (message: string) => console.log(chalk.cyan(`→ ${message}`)),
  dry: (message: string) => console.log(chalk.dim(`  [dry-run] ${message}`)),
  ok: (message: string) => console.log(chalk.green(message)),
  warn: (message: string) => console.log(chalk.yellow(message)),
  err: (message: string) => console.error(chalk.red(message)),
};

export async function runPromote(
  cwd: string,
  options: RunPromoteOptions,
): Promise<void> {
  const git = createGitService(cwd, {
    dryRun: options.dryRun,
    onDryRun: (d) => log.dry(d),
  });

  log.step("Comprobando repositorio Git…");
  if (!(await git.isRepoRoot())) {
    log.err("Este directorio no es la raíz de un repositorio Git.");
    return;
  }

  log.step("Comprobando que el árbol de trabajo esté limpio…");
  if (!(await git.isWorkingDirectoryClean())) {
    log.err(
      "El directorio de trabajo no está limpio. Confirma o descarta cambios antes de continuar.",
    );
    return;
  }

  if (options.dryRun) {
    log.warn("Modo --dry-run: no se ejecutarán cambios en el repositorio.");
  }

  const branches = await git.listLocalBranches();
  const answers = await promptPromote(branches);

  if (answers.sourceBranch === answers.targetBranch) {
    log.err("La rama origen y la destino deben ser distintas.");
    return;
  }

  if (
    !answers.createNewBranch &&
    isDirectPushForbiddenBranch(answers.targetBranch)
  ) {
    log.err(
      "No está permitido hacer push directo a release, development, master o main. Creá una rama de trabajo y abrí un PR.",
    );
    return;
  }

  if (
    answers.newBranchName &&
    isDirectPushForbiddenBranch(answers.newBranchName)
  ) {
    log.err(
      "El nombre de la rama de trabajo no puede ser release, development, master ni main.",
    );
    return;
  }

  log.step("Validando commits…");
  const fullHashes: string[] = [];
  for (const raw of answers.commitHashes) {
    if (!(await git.commitExists(raw))) {
      log.err(
        `El objeto no existe o no es un commit válido (git cat-file -t): ${raw}`,
      );
      return;
    }
    try {
      fullHashes.push(await git.resolveCommitHash(raw));
    } catch {
      log.err(`No se pudo resolver el hash: ${raw}`);
      return;
    }
  }

  const deduped: string[] = [];
  const seenFull = new Set<string>();
  for (const h of fullHashes) {
    if (seenFull.has(h)) continue;
    seenFull.add(h);
    deduped.push(h);
  }
  const uniqueFullHashes = deduped;

  log.step(`Checkout de la rama destino: ${answers.targetBranch}`);
  await git.checkout(answers.targetBranch);

  log.step(`git pull origin ${answers.targetBranch}`);
  await git.pullOrigin(answers.targetBranch);

  if (answers.createNewBranch && answers.newBranchName) {
    log.step(`Creando rama: ${answers.newBranchName}`);
    await git.checkoutNewBranch(answers.newBranchName);
  }

  const pickLabel = uniqueFullHashes.map(abbrevHash).join(", ");
  log.step(
    `Cherry-pick (${uniqueFullHashes.length}): ${pickLabel}`,
  );

  for (let i = 0; i < uniqueFullHashes.length; i++) {
    const h = uniqueFullHashes[i];
    const pick = await git.cherryPick(h);

    if (pick.kind === "error") {
      log.err(
        `Cherry-pick falló en ${abbrevHash(h)} (${i + 1}/${uniqueFullHashes.length}). Revirtiendo con git cherry-pick --abort…`,
      );
      try {
        await git.cherryPickAbort();
        log.err("Operación abortada. Detalle:");
        log.err(pick.message);
      } catch (abortErr: unknown) {
        const msg =
          abortErr instanceof Error ? abortErr.message : String(abortErr);
        log.err(`No se pudo completar cherry-pick --abort: ${msg}`);
      }
      return;
    }

    if (pick.kind === "empty") {
      log.warn(
        `Cherry-pick vacío para ${abbrevHash(h)} (${i + 1}/${uniqueFullHashes.length}). Se omite con git cherry-pick --skip…`,
      );
      try {
        await git.cherryPickSkip();
      } catch (skipErr: unknown) {
        const msg =
          skipErr instanceof Error ? skipErr.message : String(skipErr);
        log.err(`No se pudo completar cherry-pick --skip: ${msg}`);
        return;
      }
    }
  }

  const branchToPush = resolveBranchToPush(answers);
  log.step(`Push a origin (${branchToPush})`);
  await git.pushOrigin(branchToPush);

  log.ok(
    options.dryRun
      ? "Simulación finalizada."
      : "Promoción completada correctamente.",
  );
}

/** Rama que recibirá el push (coherente con dry-run: no depende de checkout real). */
function resolveBranchToPush(answers: PromotePromptAnswers): string {
  if (answers.createNewBranch && answers.newBranchName) {
    return answers.newBranchName;
  }
  return answers.targetBranch;
}

function abbrevHash(full: string): string {
  return full.slice(0, 12);
}
