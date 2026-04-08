"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runEnvSync = runEnvSync;
const path_1 = __importDefault(require("path"));
const chalk_1 = __importDefault(require("chalk"));
const codecommit_service_1 = require("./codecommit-service");
const git_service_1 = require("./git.service");
const slack_service_1 = require("./slack.service");
const env_sync_config_1 = require("../utils/env-sync-config");
const file_utils_1 = require("../utils/file.utils");
const SOURCE_BRANCH = "release";
const RELEASE_REF = `origin/${SOURCE_BRANCH}`;
const ALL_TARGETS = ["master", "development"];
/** CodeCommit limita la descripción del PR a 10.240 caracteres. */
const CODECOMMIT_PR_DESCRIPTION_MAX = 10240;
/** Margen para pie de corte y texto de cierre. */
const CODECOMMIT_PR_DESCRIPTION_SAFE = 10050;
const PR_COMMIT_SUBJECT_MAX = 160;
const log = {
    info: (m) => console.log(chalk_1.default.blue(m)),
    ok: (m) => console.log(chalk_1.default.green(m)),
    warn: (m) => console.log(chalk_1.default.yellow(m)),
    err: (m) => console.error(chalk_1.default.red(m)),
};
function repoNameFromRemote(url) {
    const base = url.replace(/\.git$/i, "");
    const parts = base.split(/[/:]/).filter(Boolean);
    return parts[parts.length - 1] ?? "repository";
}
function tempBranchFor(target, timestamp) {
    if (target === "master")
        return `g66/ci/homologate/${timestamp}`;
    return `g66/dev/homologate/${timestamp}`;
}
function normalizeWhitelistPath(entry) {
    return (0, file_utils_1.normalizeRepoPath)(entry.replace(/^[/\\]+/, ""));
}
function buildWhitelistSet(entries) {
    return new Set(entries.map(normalizeWhitelistPath));
}
function commitTouchesOnlyWhitelist(files, whitelist) {
    if (files.length === 0)
        return true;
    return files.every((f) => whitelist.has((0, file_utils_1.normalizeRepoPath)(f)));
}
async function filterCommitsExcludingWhitelistOnly(git, commits, whitelist) {
    const out = [];
    for (const c of commits) {
        const files = await git.listFilesChangedInCommit(c.hash);
        if (!commitTouchesOnlyWhitelist(files, whitelist)) {
            out.push(c);
        }
    }
    return out;
}
function targetsToProcess(only) {
    if (only)
        return [only];
    return [...ALL_TARGETS];
}
async function remoteBranchExists(git, name) {
    return git.remoteRefExists(`origin/${name}`);
}
function printDiffSummary(byTarget, targets) {
    let anyDiff = false;
    for (const t of targets) {
        const list = byTarget.get(t);
        if (list && list.length > 0) {
            anyDiff = true;
            break;
        }
    }
    if (anyDiff) {
        log.warn("⚠️ Differences detected:");
    }
    else {
        log.info("Sin commits extra en destino respecto a release (tras filtrar whitelist). La sync igual aplica.");
    }
    for (const t of targets) {
        const list = byTarget.get(t);
        if (!list || list.length === 0)
            continue;
        log.info(`Branch: ${t}`);
        for (const c of list) {
            const short = c.hash.slice(0, 12);
            log.info(`  • ${short} | ${c.author} | ${c.subject}`);
        }
    }
}
function truncatePrSubject(text, maxChars) {
    const t = text.trim().replace(/\s+/g, " ");
    if (t.length <= maxChars)
        return t;
    return `${t.slice(0, Math.max(0, maxChars - 1))}…`;
}
/**
 * Descripción del PR acotada al límite de AWS CodeCommit (10.240 caracteres).
 */
function buildPrDescription(target, commits) {
    const intro = [
        "Sincronización de rama con **release** (fuente de verdad).",
        "",
        "Rama temporal creada desde **el ambiente destino** (`origin/master` o `origin/development`); el árbol de archivos se igualó al de **release** (`git checkout origin/release -- .` tras limpiar tracked), y la whitelist se restauró desde el estado previo del destino. Así el PR no hereda el historial de `release` y evita conflictos masivos.",
        "",
    ].join("\n");
    if (commits.length === 0) {
        return `${intro}No se detectaron commits extra en el destino respecto a release (tras filtro de whitelist).`;
    }
    const listHeader = "**Commits que dejarán de estar solo en el destino (referencia):**\n\n";
    let body = `${intro}${listHeader}`;
    let shown = 0;
    for (const c of commits) {
        const line = `- \`${c.hash.slice(0, 12)}\` ${c.author} — ${truncatePrSubject(c.subject, PR_COMMIT_SUBJECT_MAX)}\n`;
        const omittedNote = (n) => `\n_(${n} commit${n === 1 ? "" : "s"} no listado${n === 1 ? "" : "s"} por límite de descripción; ver \`git log ${RELEASE_REF}..origin/${target}\`)_\n`;
        const nextLen = body.length + line.length;
        if (nextLen + omittedNote(commits.length - shown - 1).length > CODECOMMIT_PR_DESCRIPTION_SAFE) {
            const omitted = commits.length - shown;
            if (omitted > 0) {
                body += omittedNote(omitted);
            }
            break;
        }
        body += line;
        shown++;
    }
    if (shown === commits.length && body.length <= CODECOMMIT_PR_DESCRIPTION_MAX) {
        return body.trimEnd();
    }
    if (body.length > CODECOMMIT_PR_DESCRIPTION_MAX) {
        const suffix = "\n\n…[Descripción truncada por límite de AWS CodeCommit (10.240 caracteres)]";
        const cut = CODECOMMIT_PR_DESCRIPTION_MAX - suffix.length;
        return `${body.slice(0, Math.max(0, cut)).trimEnd()}${suffix}`;
    }
    return body.trimEnd();
}
async function removeLocalBranchIfExists(git, branchName, dryRun) {
    if (dryRun)
        return;
    try {
        await git.deleteLocalBranch(branchName, true);
    }
    catch {
        /* no existe */
    }
}
async function backupWhitelistFiles(repoRoot, backupDir, whitelist) {
    const restoredPaths = [];
    for (const rel of whitelist) {
        const norm = normalizeWhitelistPath(rel);
        const abs = path_1.default.join(repoRoot, ...norm.split("/"));
        const buf = await (0, file_utils_1.readFileIfExists)(abs);
        if (buf === null)
            continue;
        const dest = path_1.default.join(backupDir, norm.split("/").join(path_1.default.sep));
        await (0, file_utils_1.writeFileSafe)(dest, buf);
        restoredPaths.push(norm);
    }
    return restoredPaths;
}
async function restoreWhitelistFromBackup(repoRoot, backupDir, relativePosixPaths) {
    const added = [];
    for (const norm of relativePosixPaths) {
        const src = path_1.default.join(backupDir, ...norm.split("/"));
        if (!(await (0, file_utils_1.pathExists)(src)))
            continue;
        const buf = await (0, file_utils_1.readFileIfExists)(src);
        if (buf === null)
            continue;
        const dest = path_1.default.join(repoRoot, ...norm.split("/"));
        await (0, file_utils_1.writeFileSafe)(dest, buf);
        added.push(norm);
    }
    return added;
}
async function runEnvSync(options) {
    const { cwd, dryRun, only, verbose } = options;
    const targets = targetsToProcess(only);
    const git = (0, git_service_1.createEnvSyncGit)(cwd, {
        dryRun,
        onDryRun: (d) => log.info(`  [dry-run] ${d}`),
        verbose,
        verboseLog: (m) => console.log(chalk_1.default.dim(`  [verbose] ${m}`)),
    });
    if (!(await git.isRepoRoot())) {
        log.err("No es la raíz de un repositorio Git.");
        return;
    }
    if (!(await git.isWorkingDirectoryClean())) {
        log.err("El directorio de trabajo no está limpio. Confirmá o descartá cambios antes de continuar.");
        return;
    }
    const startRef = await git.getCurrentBranchOrHead();
    if (dryRun) {
        log.warn("Modo --dry-run: sin fetch ni cambios en el repo; solo análisis y plan.");
    }
    else {
        log.info("→ git fetch origin");
        await git.fetchOrigin();
    }
    for (const b of [SOURCE_BRANCH, ...targets]) {
        if (!(await remoteBranchExists(git, b))) {
            log.err(`No existe la rama remota origin/${b}.`);
            return;
        }
    }
    const { config: envCfg, configFileDir } = (0, env_sync_config_1.loadEnvSyncConfigWithMeta)(cwd);
    let slackCreds;
    try {
        slackCreds = (0, env_sync_config_1.resolveSlackChatCredentials)(envCfg);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.err(msg);
        return;
    }
    const effectiveWhitelist = (0, env_sync_config_1.getEffectiveEnvSyncWhitelist)(envCfg.whitelist);
    const whitelistSet = buildWhitelistSet(effectiveWhitelist);
    const byTarget = new Map();
    for (const t of targets) {
        const raw = await git.logCommitsAheadOfRelease(RELEASE_REF, `origin/${t}`);
        const filtered = await filterCommitsExcludingWhitelistOnly(git, raw, whitelistSet);
        byTarget.set(t, filtered);
    }
    printDiffSummary(byTarget, targets);
    const timestamp = Date.now();
    if (dryRun) {
        log.info("Plan de ejecución:");
        for (const target of targets) {
            const tb = tempBranchFor(target, timestamp);
            log.info(`  • ${target}: rama ${tb} → PR hacia ${target}`);
        }
        log.ok("Simulación finalizada.");
        return;
    }
    try {
        log.info(`→ checkout ${SOURCE_BRANCH} && pull`);
        await git.checkout(SOURCE_BRANCH);
        await git.pullOrigin(SOURCE_BRANCH);
        const tmpRoot = path_1.default.join(configFileDir, ".g66_tmp", "sync-envs", String(timestamp));
        log.info(`→ Backups temporales: ${tmpRoot}`);
        await (0, file_utils_1.ensureDir)(tmpRoot);
        const remoteUrl = await git.getRemoteOriginUrl();
        const repoName = repoNameFromRemote(remoteUrl);
        const slackTargets = [];
        for (const target of targets) {
            const tempBranch = tempBranchFor(target, timestamp);
            const displayCommits = byTarget.get(target) ?? [];
            const targetRef = `origin/${target}`;
            const backupDir = path_1.default.join(tmpRoot, target);
            log.info(`→ Procesando ${target} → rama temporal ${tempBranch}`);
            await removeLocalBranchIfExists(git, tempBranch, false);
            log.info(`→ git checkout -b ${tempBranch} ${targetRef}`);
            await git.checkoutNewFromRef(tempBranch, targetRef);
            await (0, file_utils_1.ensureDir)(backupDir);
            const backed = await backupWhitelistFiles(cwd, backupDir, effectiveWhitelist);
            log.info("→ Igualar árbol a origin/release (base de rama sigue siendo el ambiente destino)");
            await git.replaceTrackedTreeWithRef(RELEASE_REF);
            await restoreWhitelistFromBackup(cwd, backupDir, backed);
            await git.addAll();
            if (await git.hasStagedChanges()) {
                await git.commit(`chore: sync ${target} with release (tree from release, base unchanged)`);
            }
            else {
                log.warn(`Sin cambios para commitear en ${tempBranch} (destino ya igual a release con whitelist). Se omite push y PR para ${target}.`);
                slackTargets.push({
                    branch: target,
                    commits: displayCommits.map((c) => ({
                        hash: c.hash,
                        author: c.author,
                        subject: c.subject,
                    })),
                });
                await git.checkout(targetRef);
                await removeLocalBranchIfExists(git, tempBranch, false);
                continue;
            }
            log.info(`→ git push origin ${tempBranch}`);
            await git.pushOrigin(tempBranch);
            const title = `chore: sync ${target} with release`;
            const description = buildPrDescription(target, displayCommits);
            log.info(`→ Crear PR: ${tempBranch} → ${target}`);
            await (0, codecommit_service_1.createPullRequest)({
                repositoryName: repoName,
                sourceBranch: tempBranch,
                destinationBranch: target,
                title,
                description,
            });
            slackTargets.push({
                branch: target,
                commits: displayCommits.map((c) => ({
                    hash: c.hash,
                    author: c.author,
                    subject: c.subject,
                })),
            });
        }
        if (slackCreds) {
            try {
                await (0, slack_service_1.postEnvSyncSlackChatMessage)(slackCreds.botToken, slackCreds.channelId, {
                    sourceBranch: SOURCE_BRANCH,
                    targets: slackTargets,
                });
                log.ok("Notificación Slack enviada (chat.postMessage).");
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                log.warn(`Slack: ${msg}`);
            }
        }
        await (0, file_utils_1.removeDirRecursive)(tmpRoot).catch(() => undefined);
        log.ok("Sincronización completada (ramas temporales y PRs creados).");
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.err(msg);
        throw e;
    }
    finally {
        try {
            await git.checkout(startRef);
        }
        catch {
            log.warn("No se pudo restaurar la rama inicial automáticamente; revisá con git branch.");
        }
    }
}
