import path from "path";
import chalk from "chalk";
import { createPullRequest } from "./codecommit-service";
import { createEnvSyncGit, type ParsedCommit } from "./git.service";
import { postEnvSyncSlackChatMessage } from "./slack.service";
import {
  getEffectiveEnvSyncWhitelist,
  loadEnvSyncConfigWithMeta,
  resolveSlackChatCredentials,
  type SlackChatCredentials,
} from "../utils/env-sync-config";
import {
  ensureDir,
  normalizeRepoPath,
  pathExists,
  readFileIfExists,
  removeDirRecursive,
  writeFileSafe,
} from "../utils/file.utils";

const SOURCE_BRANCH = "release";
const RELEASE_REF = `origin/${SOURCE_BRANCH}`;
const ALL_TARGETS = ["master", "development"] as const;

/** CodeCommit limita la descripción del PR a 10.240 caracteres. */
const CODECOMMIT_PR_DESCRIPTION_MAX = 10_240;
/** Margen para pie de corte y texto de cierre. */
const CODECOMMIT_PR_DESCRIPTION_SAFE = 10_050;
const PR_COMMIT_SUBJECT_MAX = 160;

export type EnvSyncTarget = (typeof ALL_TARGETS)[number];

export interface RunEnvSyncOptions {
  cwd: string;
  dryRun: boolean;
  only?: EnvSyncTarget;
  verbose: boolean;
}

const log = {
  info: (m: string) => console.log(chalk.blue(m)),
  ok: (m: string) => console.log(chalk.green(m)),
  warn: (m: string) => console.log(chalk.yellow(m)),
  err: (m: string) => console.error(chalk.red(m)),
};

function repoNameFromRemote(url: string): string {
  const base = url.replace(/\.git$/i, "");
  const parts = base.split(/[/:]/).filter(Boolean);
  return parts[parts.length - 1] ?? "repository";
}

function tempBranchFor(target: EnvSyncTarget, timestamp: number): string {
  if (target === "master") return `g66/ci/homologate/${timestamp}`;
  return `g66/dev/homologate/${timestamp}`;
}

function normalizeWhitelistPath(entry: string): string {
  return normalizeRepoPath(entry.replace(/^[/\\]+/, ""));
}

function buildWhitelistSet(entries: string[]): Set<string> {
  return new Set(entries.map(normalizeWhitelistPath));
}

function commitTouchesOnlyWhitelist(
  files: string[],
  whitelist: Set<string>,
): boolean {
  if (files.length === 0) return true;
  return files.every((f) => whitelist.has(normalizeRepoPath(f)));
}

async function filterCommitsExcludingWhitelistOnly(
  git: ReturnType<typeof createEnvSyncGit>,
  commits: ParsedCommit[],
  whitelist: Set<string>,
): Promise<ParsedCommit[]> {
  const out: ParsedCommit[] = [];
  for (const c of commits) {
    const files = await git.listFilesChangedInCommit(c.hash);
    if (!commitTouchesOnlyWhitelist(files, whitelist)) {
      out.push(c);
    }
  }
  return out;
}

function targetsToProcess(only?: EnvSyncTarget): EnvSyncTarget[] {
  if (only) return [only];
  return [...ALL_TARGETS];
}

async function remoteBranchExists(
  git: ReturnType<typeof createEnvSyncGit>,
  name: string,
): Promise<boolean> {
  return git.remoteRefExists(`origin/${name}`);
}

function printDiffSummary(
  byTarget: Map<EnvSyncTarget, ParsedCommit[]>,
  targets: EnvSyncTarget[],
): void {
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
  } else {
    log.info(
      "Sin commits extra en destino respecto a release (tras filtrar whitelist). La sync igual aplica.",
    );
  }
  for (const t of targets) {
    const list = byTarget.get(t);
    if (!list || list.length === 0) continue;
    log.info(`Branch: ${t}`);
    for (const c of list) {
      const short = c.hash.slice(0, 12);
      log.info(`  • ${short} | ${c.author} | ${c.subject}`);
    }
  }
}

function truncatePrSubject(text: string, maxChars: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(0, maxChars - 1))}…`;
}

/**
 * Descripción del PR acotada al límite de AWS CodeCommit (10.240 caracteres).
 */
function buildPrDescription(
  target: string,
  commits: ParsedCommit[],
): string {
  const intro = [
    "Sincronización de rama con **release** (fuente de verdad).",
    "",
    "Rama temporal creada desde **el ambiente destino** (`origin/master` o `origin/development`); el árbol de archivos se igualó al de **release** (`git checkout origin/release -- .` tras limpiar tracked), y la whitelist se restauró desde el estado previo del destino. Así el PR no hereda el historial de `release` y evita conflictos masivos.",
    "",
  ].join("\n");

  if (commits.length === 0) {
    return `${intro}No se detectaron commits extra en el destino respecto a release (tras filtro de whitelist).`;
  }

  const listHeader =
    "**Commits que dejarán de estar solo en el destino (referencia):**\n\n";
  let body = `${intro}${listHeader}`;
  let shown = 0;

  for (const c of commits) {
    const line = `- \`${c.hash.slice(0, 12)}\` ${c.author} — ${truncatePrSubject(c.subject, PR_COMMIT_SUBJECT_MAX)}\n`;
    const omittedNote = (n: number) =>
      `\n_(${n} commit${n === 1 ? "" : "s"} no listado${n === 1 ? "" : "s"} por límite de descripción; ver \`git log ${RELEASE_REF}..origin/${target}\`)_\n`;
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
    const suffix =
      "\n\n…[Descripción truncada por límite de AWS CodeCommit (10.240 caracteres)]";
    const cut = CODECOMMIT_PR_DESCRIPTION_MAX - suffix.length;
    return `${body.slice(0, Math.max(0, cut)).trimEnd()}${suffix}`;
  }

  return body.trimEnd();
}

async function removeLocalBranchIfExists(
  git: ReturnType<typeof createEnvSyncGit>,
  branchName: string,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;
  try {
    await git.deleteLocalBranch(branchName, true);
  } catch {
    /* no existe */
  }
}

async function backupWhitelistFiles(
  repoRoot: string,
  backupDir: string,
  whitelist: string[],
): Promise<string[]> {
  const restoredPaths: string[] = [];
  for (const rel of whitelist) {
    const norm = normalizeWhitelistPath(rel);
    const abs = path.join(repoRoot, ...norm.split("/"));
    const buf = await readFileIfExists(abs);
    if (buf === null) continue;
    const dest = path.join(backupDir, norm.split("/").join(path.sep));
    await writeFileSafe(dest, buf);
    restoredPaths.push(norm);
  }
  return restoredPaths;
}

async function restoreWhitelistFromBackup(
  repoRoot: string,
  backupDir: string,
  relativePosixPaths: string[],
): Promise<string[]> {
  const added: string[] = [];
  for (const norm of relativePosixPaths) {
    const src = path.join(backupDir, ...norm.split("/"));
    if (!(await pathExists(src))) continue;
    const buf = await readFileIfExists(src);
    if (buf === null) continue;
    const dest = path.join(repoRoot, ...norm.split("/"));
    await writeFileSafe(dest, buf);
    added.push(norm);
  }
  return added;
}

export async function runEnvSync(options: RunEnvSyncOptions): Promise<void> {
  const { cwd, dryRun, only, verbose } = options;
  const targets = targetsToProcess(only);

  const git = createEnvSyncGit(cwd, {
    dryRun,
    onDryRun: (d) => log.info(`  [dry-run] ${d}`),
    verbose,
    verboseLog: (m) => console.log(chalk.dim(`  [verbose] ${m}`)),
  });

  if (!(await git.isRepoRoot())) {
    log.err("No es la raíz de un repositorio Git.");
    return;
  }

  if (!(await git.isWorkingDirectoryClean())) {
    log.err(
      "El directorio de trabajo no está limpio. Confirmá o descartá cambios antes de continuar.",
    );
    return;
  }

  const startRef = await git.getCurrentBranchOrHead();

  if (dryRun) {
    log.warn(
      "Modo --dry-run: sin fetch ni cambios en el repo; solo análisis y plan.",
    );
  } else {
    log.info("→ git fetch origin");
    await git.fetchOrigin();
  }

  for (const b of [SOURCE_BRANCH, ...targets]) {
    if (!(await remoteBranchExists(git, b))) {
      log.err(`No existe la rama remota origin/${b}.`);
      return;
    }
  }

  const { config: envCfg, configFileDir } = loadEnvSyncConfigWithMeta(cwd);

  let slackCreds: SlackChatCredentials | null;
  try {
    slackCreds = resolveSlackChatCredentials(envCfg);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.err(msg);
    return;
  }

  const effectiveWhitelist = getEffectiveEnvSyncWhitelist(envCfg.whitelist);
  const whitelistSet = buildWhitelistSet(effectiveWhitelist);

  const byTarget = new Map<EnvSyncTarget, ParsedCommit[]>();
  for (const t of targets) {
    const raw = await git.logCommitsAheadOfRelease(RELEASE_REF, `origin/${t}`);
    const filtered = await filterCommitsExcludingWhitelistOnly(
      git,
      raw,
      whitelistSet,
    );
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

    const tmpRoot = path.join(
      configFileDir,
      ".g66_tmp",
      "sync-envs",
      String(timestamp),
    );
    log.info(`→ Backups temporales: ${tmpRoot}`);
    await ensureDir(tmpRoot);

    const remoteUrl = await git.getRemoteOriginUrl();
    const repoName = repoNameFromRemote(remoteUrl);

    const slackTargets: Array<{
      branch: string;
      commits: Array<{ hash: string; author: string; subject: string }>;
    }> = [];

    for (const target of targets) {
      const tempBranch = tempBranchFor(target, timestamp);
      const displayCommits = byTarget.get(target) ?? [];
      const targetRef = `origin/${target}`;
      const backupDir = path.join(tmpRoot, target);

      log.info(`→ Procesando ${target} → rama temporal ${tempBranch}`);

      await removeLocalBranchIfExists(git, tempBranch, false);
      log.info(`→ git checkout -b ${tempBranch} ${targetRef}`);
      await git.checkoutNewFromRef(tempBranch, targetRef);

      await ensureDir(backupDir);
      const backed = await backupWhitelistFiles(
        cwd,
        backupDir,
        effectiveWhitelist,
      );

      log.info(
        "→ Igualar árbol a origin/release (base de rama sigue siendo el ambiente destino)",
      );
      await git.replaceTrackedTreeWithRef(RELEASE_REF);

      await restoreWhitelistFromBackup(cwd, backupDir, backed);

      await git.addAll();
      if (await git.hasStagedChanges()) {
        await git.commit(
          `chore: sync ${target} with release (tree from release, base unchanged)`,
        );
      } else {
        log.warn(
          `Sin cambios para commitear en ${tempBranch} (destino ya igual a release con whitelist). Se omite push y PR para ${target}.`,
        );
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
      await createPullRequest({
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
        await postEnvSyncSlackChatMessage(
          slackCreds.botToken,
          slackCreds.channelId,
          {
            sourceBranch: SOURCE_BRANCH,
            targets: slackTargets,
          },
        );
        log.ok("Notificación Slack enviada (chat.postMessage).");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.warn(`Slack: ${msg}`);
      }
    }

    await removeDirRecursive(tmpRoot).catch(() => undefined);

    log.ok("Sincronización completada (ramas temporales y PRs creados).");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.err(msg);
    throw e;
  } finally {
    try {
      await git.checkout(startRef);
    } catch {
      log.warn(
        "No se pudo restaurar la rama inicial automáticamente; revisá con git branch.",
      );
    }
  }
}
