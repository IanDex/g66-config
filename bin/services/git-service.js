"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitService = void 0;
exports.createGitService = createGitService;
const simple_git_1 = __importStar(require("simple-git"));
class GitService {
    constructor(git, options = {}) {
        this.git = git;
        this.options = options;
    }
    isDryRun() {
        return Boolean(this.options.dryRun);
    }
    async skipIfDry(description) {
        if (!this.isDryRun()) {
            return false;
        }
        this.options.onDryRun?.(description);
        return true;
    }
    async isRepoRoot() {
        return this.git.checkIsRepo(simple_git_1.CheckRepoActions.IS_REPO_ROOT);
    }
    async listLocalBranches() {
        const summary = await this.git.branchLocal();
        return [...summary.all].sort((a, b) => a.localeCompare(b));
    }
    async getWorkingTreeStatus() {
        return this.git.status();
    }
    async isWorkingDirectoryClean() {
        const s = await this.getWorkingTreeStatus();
        return s.isClean();
    }
    /**
     * Validates commit object via `git cat-file -t` (must be `commit`).
     */
    async commitExists(hash) {
        try {
            const t = (await this.git.raw(["cat-file", "-t", hash.trim()])).trim();
            return t === "commit";
        }
        catch {
            return false;
        }
    }
    async resolveCommitHash(hash) {
        return (await this.git.raw(["rev-parse", "--verify", `${hash.trim()}^{commit}`])).trim();
    }
    /**
     * True if `hash` is already reachable from `branchRef` (e.g. already merged into target).
     */
    async isCommitInBranchHistory(branchRef, hash) {
        try {
            await this.git.raw(["merge-base", "--is-ancestor", hash, branchRef]);
            return true;
        }
        catch {
            return false;
        }
    }
    async getCurrentBranch() {
        return (await this.git.revparse(["--abbrev-ref", "HEAD"])).trim();
    }
    async checkout(branch) {
        if (await this.skipIfDry(`git checkout ${branch}`))
            return;
        await this.git.checkout(branch);
    }
    async pullOrigin(branch) {
        if (await this.skipIfDry(`git pull origin ${branch}`))
            return;
        await this.git.pull("origin", branch);
    }
    async checkoutNewBranch(name) {
        if (await this.skipIfDry(`git checkout -b ${name}`))
            return;
        await this.git.checkoutLocalBranch(name);
    }
    async cherryPick(hash) {
        if (await this.skipIfDry(`git cherry-pick ${hash}`)) {
            return { kind: "ok" };
        }
        try {
            await this.git.raw(["cherry-pick", hash]);
            return { kind: "ok" };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (isEmptyCherryPickMessage(msg)) {
                return { kind: "empty" };
            }
            return { kind: "error", message: msg };
        }
    }
    async cherryPickAbort() {
        if (await this.skipIfDry("git cherry-pick --abort"))
            return;
        await this.git.raw(["cherry-pick", "--abort"]);
    }
    async cherryPickSkip() {
        if (await this.skipIfDry("git cherry-pick --skip"))
            return;
        await this.git.raw(["cherry-pick", "--skip"]);
    }
    async pushOrigin(branch) {
        if (await this.skipIfDry(`git push origin ${branch}`))
            return;
        await this.git.push("origin", branch);
    }
}
exports.GitService = GitService;
function createGitService(cwd, options) {
    return new GitService((0, simple_git_1.default)({ baseDir: cwd }), options);
}
function isEmptyCherryPickMessage(message) {
    const m = message.toLowerCase();
    return (m.includes("nothing to commit") ||
        m.includes("previous cherry-pick is now empty") ||
        m.includes("cherry-pick is empty"));
}
