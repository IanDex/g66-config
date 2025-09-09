import { execSync } from 'child_process';
import * as path from 'path';

export function isBranchPushed(branch: string): boolean {
  try {
    const result = execSync(`git ls-remote --heads origin ${branch}`).toString().trim();
    return result.length > 0;
  } catch {
    return false;
  }
}

export function hasCommitsToPush(baseBranch: string): boolean {
  try {
    const result = execSync(`git log origin/${baseBranch}..HEAD --oneline`).toString().trim();
    return result.length > 0;
  } catch {
    return false;
  }
}

export function getCurrentBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
  } catch (err) {
    throw new Error('⚠️ No se pudo obtener la rama actual. ¿Estás en un repo Git?');
  }
}

export function inferEnvironment(branch: string): 'dev' | 'ci' {
  if (branch.includes('/ci/') || branch.includes('ci')) return 'ci';
  return 'dev';
}

export function getRepoName(): string {
  try {
    const remoteUrl = execSync('git config --get remote.origin.url').toString().trim();
    const repoName = path.basename(remoteUrl, '.git');
    return repoName;
  } catch (err) {
    throw new Error('⚠️ No se pudo obtener el nombre del repositorio. ¿Está configurado el remote?');
  }
}
