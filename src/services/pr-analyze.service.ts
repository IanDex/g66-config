import chalk from "chalk";
import simpleGit from "simple-git";
import { getPullRequestDetails } from "./codecommit-service";
import { getRepoName } from "../utils/git-utils";

/** DEV */
const REF_DEVELOPMENT = "origin/development";
/** CI (master) */
const REF_MASTER = "origin/master";

type SimpleGitIns = ReturnType<typeof simpleGit>;

/** OID del blob (o del commit si submodule) en `commitish:path`; null si el path no existe en ese commit. */
async function resolveBlobAtPath(
  git: SimpleGitIns,
  commitish: string,
  filePath: string,
): Promise<string | null> {
  try {
    const out = await git.raw(["rev-parse", `${commitish}:${filePath}`]);
    return out.trim();
  } catch {
    return null;
  }
}

/** Rutas con diferencias entre el árbol del PR base y el tip del PR (= cambios que introduce el PR). */
async function pathsChangedInPr(
  git: SimpleGitIns,
  destinationCommit: string,
  sourceCommit: string,
): Promise<string[]> {
  const out = await git.raw([
    "diff",
    "-z",
    "--name-only",
    destinationCommit,
    sourceCommit,
  ]);
  if (!out.trim()) return [];
  return out.split("\0").filter(Boolean);
}

/**
 * ¿La rama `branchRef` tiene exactamente el mismo contenido que el PR post-merge (tip `sourceCommit`)
 * para todos los archivos que el PR modifica?
 */
async function branchMatchesPrChanges(
  git: SimpleGitIns,
  destinationCommit: string,
  sourceCommit: string,
  branchRef: string,
): Promise<{ ok: boolean; mismatches: string[] }> {
  const paths = await pathsChangedInPr(git, destinationCommit, sourceCommit);

  if (paths.length === 0) {
    const out = await git.raw([
      "diff",
      "--name-only",
      sourceCommit,
      branchRef,
    ]);
    const diffPaths = out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return {
      ok: diffPaths.length === 0,
      mismatches:
        diffPaths.length > 0
          ? diffPaths.slice(0, 15)
          : [],
    };
  }

  const mismatches: string[] = [];
  for (const p of paths) {
    const want = await resolveBlobAtPath(git, sourceCommit, p);
    const have = await resolveBlobAtPath(git, branchRef, p);
    if (want !== have) {
      mismatches.push(p);
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

export async function runPrAnalyze(cwd: string, prId: string): Promise<void> {
  const details = await getPullRequestDetails(prId);
  const localRepo = getRepoName();

  const target = details.targets.find((t) => t.repositoryName === localRepo);
  if (!target) {
    const names = details.targets.map((t) => t.repositoryName).join(", ");
    throw new Error(
      `Ningún target del PR coincide con el repo actual "${localRepo}". Targets: ${names || "(vacío)"}`,
    );
  }

  const { sourceCommit, destinationCommit, sourceReference, destinationReference } =
    target;
  if (!sourceCommit || !destinationCommit) {
    throw new Error(
      "CodeCommit no devolvió sourceCommit o destinationCommit para este PR.",
    );
  }

  const git = simpleGit({ baseDir: cwd });
  console.log(chalk.blue("→ git fetch origin"));
  await git.fetch("origin");

  const paths = await pathsChangedInPr(git, destinationCommit, sourceCommit);

  const devResult = await branchMatchesPrChanges(
    git,
    destinationCommit,
    sourceCommit,
    REF_DEVELOPMENT,
  );
  const ciResult = await branchMatchesPrChanges(
    git,
    destinationCommit,
    sourceCommit,
    REF_MASTER,
  );

  console.log("");
  console.log(chalk.cyan(`PR #${details.pullRequestId}: ${details.title}`));
  console.log(chalk.dim(`Estado CodeCommit: ${details.status}`));
  console.log(chalk.dim(`${sourceReference} → ${destinationReference}`));
  console.log(
    chalk.dim(
      `Análisis: mismo contenido que el tip del PR (${sourceCommit.slice(0, 12)}) en cada archivo tocado por el diff PR base→tip.`,
    ),
  );
  console.log(chalk.dim(`Archivos distintos entre base del PR y tip del PR: ${paths.length}`));
  console.log("");

  const devLabel = devResult.ok
    ? chalk.green("dev ok")
    : chalk.red("dev no ok");
  const ciLabel = ciResult.ok ? chalk.green("ci ok") : chalk.red("ci no ok");
  console.log(`${devLabel}  |  ${ciLabel}`);
  console.log("");

  if (!devResult.ok && devResult.mismatches.length > 0) {
    console.log(chalk.yellow(`development — archivos que no coinciden con el PR (máx. 15):`));
    for (const p of devResult.mismatches) {
      console.log(chalk.dim(`  • ${p}`));
    }
    console.log("");
  }
  if (!ciResult.ok && ciResult.mismatches.length > 0) {
    console.log(chalk.yellow(`master (CI) — archivos que no coinciden con el PR (máx. 15):`));
    for (const p of ciResult.mismatches) {
      console.log(chalk.dim(`  • ${p}`));
    }
    console.log("");
  }

  console.log(
    chalk.dim(
      "Criterio: para cada ruta en git diff(base PR, tip PR), el blob debe coincidir con origin/development y origin/master.",
    ),
  );
}
