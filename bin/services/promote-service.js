"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPromote = runPromote;
const chalk_1 = __importDefault(require("chalk"));
const git_service_1 = require("./git-service");
const promote_prompts_1 = require("../prompts/promote-prompts");
const promote_constants_1 = require("../utils/promote-constants");
const log = {
    step: (message) => console.log(chalk_1.default.cyan(`→ ${message}`)),
    dry: (message) => console.log(chalk_1.default.dim(`  [dry-run] ${message}`)),
    ok: (message) => console.log(chalk_1.default.green(message)),
    warn: (message) => console.log(chalk_1.default.yellow(message)),
    err: (message) => console.error(chalk_1.default.red(message)),
};
async function runPromote(cwd, options) {
    const git = (0, git_service_1.createGitService)(cwd, {
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
        log.err("El directorio de trabajo no está limpio. Confirma o descarta cambios antes de continuar.");
        return;
    }
    if (options.dryRun) {
        log.warn("Modo --dry-run: no se ejecutarán cambios en el repositorio.");
    }
    const branches = await git.listLocalBranches();
    const answers = await (0, promote_prompts_1.promptPromote)(branches);
    if (answers.sourceBranch === answers.targetBranch) {
        log.err("La rama origen y la destino deben ser distintas.");
        return;
    }
    if (!answers.createNewBranch &&
        (0, promote_constants_1.isDirectPushForbiddenBranch)(answers.targetBranch)) {
        log.err("No está permitido hacer push directo a release, development, master o main. Creá una rama de trabajo y abrí un PR.");
        return;
    }
    if (answers.newBranchName &&
        (0, promote_constants_1.isDirectPushForbiddenBranch)(answers.newBranchName)) {
        log.err("El nombre de la rama de trabajo no puede ser release, development, master ni main.");
        return;
    }
    log.step("Validando commits…");
    const fullHashes = [];
    for (const raw of answers.commitHashes) {
        if (!(await git.commitExists(raw))) {
            log.err(`El objeto no existe o no es un commit válido (git cat-file -t): ${raw}`);
            return;
        }
        try {
            fullHashes.push(await git.resolveCommitHash(raw));
        }
        catch {
            log.err(`No se pudo resolver el hash: ${raw}`);
            return;
        }
    }
    const deduped = [];
    const seenFull = new Set();
    for (const h of fullHashes) {
        if (seenFull.has(h))
            continue;
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
    log.step(`Cherry-pick (${uniqueFullHashes.length}): ${pickLabel}`);
    for (let i = 0; i < uniqueFullHashes.length; i++) {
        const h = uniqueFullHashes[i];
        const pick = await git.cherryPick(h);
        if (pick.kind === "error") {
            log.err(`Cherry-pick falló en ${abbrevHash(h)} (${i + 1}/${uniqueFullHashes.length}). Revirtiendo con git cherry-pick --abort…`);
            try {
                await git.cherryPickAbort();
                log.err("Operación abortada. Detalle:");
                log.err(pick.message);
            }
            catch (abortErr) {
                const msg = abortErr instanceof Error ? abortErr.message : String(abortErr);
                log.err(`No se pudo completar cherry-pick --abort: ${msg}`);
            }
            return;
        }
        if (pick.kind === "empty") {
            log.warn(`Cherry-pick vacío para ${abbrevHash(h)} (${i + 1}/${uniqueFullHashes.length}). Se omite con git cherry-pick --skip…`);
            try {
                await git.cherryPickSkip();
            }
            catch (skipErr) {
                const msg = skipErr instanceof Error ? skipErr.message : String(skipErr);
                log.err(`No se pudo completar cherry-pick --skip: ${msg}`);
                return;
            }
        }
    }
    const branchToPush = resolveBranchToPush(answers);
    log.step(`Push a origin (${branchToPush})`);
    await git.pushOrigin(branchToPush);
    log.ok(options.dryRun
        ? "Simulación finalizada."
        : "Promoción completada correctamente.");
}
/** Rama que recibirá el push (coherente con dry-run: no depende de checkout real). */
function resolveBranchToPush(answers) {
    if (answers.createNewBranch && answers.newBranchName) {
        return answers.newBranchName;
    }
    return answers.targetBranch;
}
function abbrevHash(full) {
    return full.slice(0, 12);
}
