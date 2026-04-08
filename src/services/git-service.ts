import simpleGit, {
  CheckRepoActions,
  type SimpleGit,
  type StatusResult,
} from "simple-git";

export interface GitServiceOptions {
  dryRun?: boolean;
  onDryRun?: (description: string) => void;
}

export type CherryPickStepResult =
  | { kind: "ok" }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export class GitService {
  constructor(
    private readonly git: SimpleGit,
    private readonly options: GitServiceOptions = {},
  ) {}

  private isDryRun(): boolean {
    return Boolean(this.options.dryRun);
  }

  private async skipIfDry(description: string): Promise<boolean> {
    if (!this.isDryRun()) {
      return false;
    }
    this.options.onDryRun?.(description);
    return true;
  }

  async isRepoRoot(): Promise<boolean> {
    return this.git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
  }

  async listLocalBranches(): Promise<string[]> {
    const summary = await this.git.branchLocal();
    return [...summary.all].sort((a, b) => a.localeCompare(b));
  }

  async getWorkingTreeStatus(): Promise<StatusResult> {
    return this.git.status();
  }

  async isWorkingDirectoryClean(): Promise<boolean> {
    const s = await this.getWorkingTreeStatus();
    return s.isClean();
  }

  /**
   * Validates commit object via `git cat-file -t` (must be `commit`).
   */
  async commitExists(hash: string): Promise<boolean> {
    try {
      const t = (await this.git.raw(["cat-file", "-t", hash.trim()])).trim();
      return t === "commit";
    } catch {
      return false;
    }
  }

  async resolveCommitHash(hash: string): Promise<string> {
    return (
      await this.git.raw(["rev-parse", "--verify", `${hash.trim()}^{commit}`])
    ).trim();
  }

  /**
   * True if `hash` is already reachable from `branchRef` (e.g. already merged into target).
   */
  async isCommitInBranchHistory(branchRef: string, hash: string): Promise<boolean> {
    try {
      await this.git.raw(["merge-base", "--is-ancestor", hash, branchRef]);
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentBranch(): Promise<string> {
    return (await this.git.revparse(["--abbrev-ref", "HEAD"])).trim();
  }

  async checkout(branch: string): Promise<void> {
    if (await this.skipIfDry(`git checkout ${branch}`)) return;
    await this.git.checkout(branch);
  }

  async pullOrigin(branch: string): Promise<void> {
    if (await this.skipIfDry(`git pull origin ${branch}`)) return;
    await this.git.pull("origin", branch);
  }

  async checkoutNewBranch(name: string): Promise<void> {
    if (await this.skipIfDry(`git checkout -b ${name}`)) return;
    await this.git.checkoutLocalBranch(name);
  }

  async cherryPick(hash: string): Promise<CherryPickStepResult> {
    if (await this.skipIfDry(`git cherry-pick ${hash}`)) {
      return { kind: "ok" };
    }
    try {
      await this.git.raw(["cherry-pick", hash]);
      return { kind: "ok" };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isEmptyCherryPickMessage(msg)) {
        return { kind: "empty" };
      }
      return { kind: "error", message: msg };
    }
  }

  async cherryPickAbort(): Promise<void> {
    if (await this.skipIfDry("git cherry-pick --abort")) return;
    await this.git.raw(["cherry-pick", "--abort"]);
  }

  async cherryPickSkip(): Promise<void> {
    if (await this.skipIfDry("git cherry-pick --skip")) return;
    await this.git.raw(["cherry-pick", "--skip"]);
  }

  async pushOrigin(branch: string): Promise<void> {
    if (await this.skipIfDry(`git push origin ${branch}`)) return;
    await this.git.push("origin", branch);
  }
}

export function createGitService(
  cwd: string,
  options?: GitServiceOptions,
): GitService {
  return new GitService(simpleGit({ baseDir: cwd }), options);
}

function isEmptyCherryPickMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("nothing to commit") ||
    m.includes("previous cherry-pick is now empty") ||
    m.includes("cherry-pick is empty")
  );
}
