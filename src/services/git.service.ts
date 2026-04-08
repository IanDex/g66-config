import simpleGit, {
  CheckRepoActions,
  type SimpleGit,
} from "simple-git";

export interface ParsedCommit {
  hash: string;
  author: string;
  subject: string;
}

export interface EnvSyncGitOptions {
  dryRun?: boolean;
  onDryRun?: (description: string) => void;
  verbose?: boolean;
  verboseLog?: (message: string) => void;
}

export class EnvSyncGit {
  private readonly git: SimpleGit;

  constructor(
    private readonly cwd: string,
    private readonly options: EnvSyncGitOptions = {},
  ) {
    this.git = simpleGit({ baseDir: cwd });
  }

  private v(msg: string): void {
    if (this.options.verbose) {
      this.options.verboseLog?.(msg);
    }
  }

  private async skipIfDry(description: string): Promise<boolean> {
    if (!this.options.dryRun) return false;
    this.options.onDryRun?.(description);
    return true;
  }

  async isRepoRoot(): Promise<boolean> {
    return this.git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
  }

  async isWorkingDirectoryClean(): Promise<boolean> {
    const s = await this.git.status();
    return s.isClean();
  }

  async fetchOrigin(): Promise<void> {
    if (await this.skipIfDry("git fetch origin")) return;
    await this.git.fetch("origin");
  }

  async remoteRefExists(ref: string): Promise<boolean> {
    try {
      await this.git.raw(["rev-parse", "--verify", ref]);
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentBranchOrHead(): Promise<string> {
    const name = (await this.git.revparse(["--abbrev-ref", "HEAD"])).trim();
    if (name === "HEAD") {
      return (await this.git.revparse(["HEAD"])).trim();
    }
    return name;
  }

  async checkout(branch: string): Promise<void> {
    if (await this.skipIfDry(`git checkout ${branch}`)) return;
    await this.git.checkout(branch);
  }

  async pullOrigin(branch: string): Promise<void> {
    if (await this.skipIfDry(`git pull origin ${branch}`)) return;
    await this.git.pull("origin", branch);
  }

  /**
   * Commits en `targetRef` que no están en `releaseRef` (equiv. `git log release..target`).
   */
  async logCommitsAheadOfRelease(
    releaseRef: string,
    targetRef: string,
  ): Promise<ParsedCommit[]> {
    const range = `${releaseRef}..${targetRef}`;
    this.v(`git log ${range}`);
    const out = await this.git.raw([
      "log",
      range,
      "--pretty=format:%H%x1f%an%x1f%s%x1e",
    ]);
    if (!out.trim()) return [];
    const commits: ParsedCommit[] = [];
    for (const block of out.split("\x1e")) {
      const t = block.trim();
      if (!t) continue;
      const parts = t.split("\x1f");
      if (parts.length >= 3) {
        commits.push({
          hash: parts[0],
          author: parts[1],
          subject: parts[2],
        });
      }
    }
    return commits;
  }

  async listFilesChangedInCommit(hash: string): Promise<string[]> {
    const out = await this.git.raw([
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      hash,
    ]);
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  /**
   * Create branch `newBranch` starting at `startRef` (e.g. origin/master).
   */
  async checkoutNewFromRef(newBranch: string, startRef: string): Promise<void> {
    const cmd = `git checkout -b ${newBranch} ${startRef}`;
    if (await this.skipIfDry(cmd)) return;
    await this.git.raw(["checkout", "-b", newBranch, startRef]);
  }

  async resetHard(ref: string): Promise<void> {
    if (await this.skipIfDry(`git reset --hard ${ref}`)) return;
    await this.git.raw(["reset", "--hard", ref]);
  }

  /**
   * Sin cambiar el commit base de la rama (sigue siendo master/development):
   * vacía el índice de lo trackeado y vuelve a llenarlo con el árbol de `sourceRef`
   * (equiv. a borrar tracked + `git checkout <sourceRef> -- .`).
   */
  async replaceTrackedTreeWithRef(sourceRef: string): Promise<void> {
    const desc = `git rm -rf -- . && git checkout ${sourceRef} -- .`;
    if (await this.skipIfDry(desc)) return;
    const listed = (await this.git.raw(["ls-files"])).trim();
    if (listed.length > 0) {
      await this.git.raw(["rm", "-rf", "--", "."]);
    }
    await this.git.raw(["checkout", sourceRef, "--", "."]);
  }

  async addAll(): Promise<void> {
    if (await this.skipIfDry("git add -A")) return;
    await this.git.raw(["add", "-A"]);
  }

  async add(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    if (await this.skipIfDry(`git add ${paths.join(" ")}`)) return;
    await this.git.add(paths);
  }

  async commit(message: string): Promise<void> {
    if (await this.skipIfDry(`git commit -m "${message}"`)) return;
    await this.git.commit(message);
  }

  async hasStagedChanges(): Promise<boolean> {
    const s = await this.git.status();
    return s.staged.length > 0;
  }

  async pushOrigin(branch: string): Promise<void> {
    if (await this.skipIfDry(`git push origin ${branch}`)) return;
    await this.git.push("origin", branch);
  }

  async getRemoteOriginUrl(): Promise<string> {
    return (await this.git.raw(["config", "--get", "remote.origin.url"])).trim();
  }

  async deleteLocalBranch(branch: string, force = false): Promise<void> {
    if (await this.skipIfDry(`git branch ${force ? "-D" : "-d"} ${branch}`)) {
      return;
    }
    await this.git.deleteLocalBranch(branch, force);
  }
}

export function createEnvSyncGit(
  cwd: string,
  options?: EnvSyncGitOptions,
): EnvSyncGit {
  return new EnvSyncGit(cwd, options);
}
