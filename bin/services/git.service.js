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
exports.EnvSyncGit = void 0;
exports.createEnvSyncGit = createEnvSyncGit;
const simple_git_1 = __importStar(require("simple-git"));
class EnvSyncGit {
    constructor(cwd, options = {}) {
        this.cwd = cwd;
        this.options = options;
        this.git = (0, simple_git_1.default)({ baseDir: cwd });
    }
    v(msg) {
        if (this.options.verbose) {
            this.options.verboseLog?.(msg);
        }
    }
    async skipIfDry(description) {
        if (!this.options.dryRun)
            return false;
        this.options.onDryRun?.(description);
        return true;
    }
    async isRepoRoot() {
        return this.git.checkIsRepo(simple_git_1.CheckRepoActions.IS_REPO_ROOT);
    }
    async isWorkingDirectoryClean() {
        const s = await this.git.status();
        return s.isClean();
    }
    async fetchOrigin() {
        if (await this.skipIfDry("git fetch origin"))
            return;
        await this.git.fetch("origin");
    }
    async remoteRefExists(ref) {
        try {
            await this.git.raw(["rev-parse", "--verify", ref]);
            return true;
        }
        catch {
            return false;
        }
    }
    async getCurrentBranchOrHead() {
        const name = (await this.git.revparse(["--abbrev-ref", "HEAD"])).trim();
        if (name === "HEAD") {
            return (await this.git.revparse(["HEAD"])).trim();
        }
        return name;
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
    /**
     * Commits en `targetRef` que no están en `releaseRef` (equiv. `git log release..target`).
     */
    async logCommitsAheadOfRelease(releaseRef, targetRef) {
        const range = `${releaseRef}..${targetRef}`;
        this.v(`git log ${range}`);
        const out = await this.git.raw([
            "log",
            range,
            "--pretty=format:%H%x1f%an%x1f%s%x1e",
        ]);
        if (!out.trim())
            return [];
        const commits = [];
        for (const block of out.split("\x1e")) {
            const t = block.trim();
            if (!t)
                continue;
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
    async listFilesChangedInCommit(hash) {
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
    async checkoutNewFromRef(newBranch, startRef) {
        const cmd = `git checkout -b ${newBranch} ${startRef}`;
        if (await this.skipIfDry(cmd))
            return;
        await this.git.raw(["checkout", "-b", newBranch, startRef]);
    }
    async resetHard(ref) {
        if (await this.skipIfDry(`git reset --hard ${ref}`))
            return;
        await this.git.raw(["reset", "--hard", ref]);
    }
    /**
     * Sin cambiar el commit base de la rama (sigue siendo master/development):
     * vacía el índice de lo trackeado y vuelve a llenarlo con el árbol de `sourceRef`
     * (equiv. a borrar tracked + `git checkout <sourceRef> -- .`).
     */
    async replaceTrackedTreeWithRef(sourceRef) {
        const desc = `git rm -rf -- . && git checkout ${sourceRef} -- .`;
        if (await this.skipIfDry(desc))
            return;
        const listed = (await this.git.raw(["ls-files"])).trim();
        if (listed.length > 0) {
            await this.git.raw(["rm", "-rf", "--", "."]);
        }
        await this.git.raw(["checkout", sourceRef, "--", "."]);
    }
    async addAll() {
        if (await this.skipIfDry("git add -A"))
            return;
        await this.git.raw(["add", "-A"]);
    }
    async add(paths) {
        if (paths.length === 0)
            return;
        if (await this.skipIfDry(`git add ${paths.join(" ")}`))
            return;
        await this.git.add(paths);
    }
    async commit(message) {
        if (await this.skipIfDry(`git commit -m "${message}"`))
            return;
        await this.git.commit(message);
    }
    async hasStagedChanges() {
        const s = await this.git.status();
        return s.staged.length > 0;
    }
    async pushOrigin(branch) {
        if (await this.skipIfDry(`git push origin ${branch}`))
            return;
        await this.git.push("origin", branch);
    }
    async getRemoteOriginUrl() {
        return (await this.git.raw(["config", "--get", "remote.origin.url"])).trim();
    }
    async deleteLocalBranch(branch, force = false) {
        if (await this.skipIfDry(`git branch ${force ? "-D" : "-d"} ${branch}`)) {
            return;
        }
        await this.git.deleteLocalBranch(branch, force);
    }
}
exports.EnvSyncGit = EnvSyncGit;
function createEnvSyncGit(cwd, options) {
    return new EnvSyncGit(cwd, options);
}
