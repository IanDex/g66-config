"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectServiceInfo = detectServiceInfo;
const simple_git_1 = __importDefault(require("simple-git"));
const path_1 = __importDefault(require("path"));
async function detectServiceInfo(cwd) {
    const serviceDirName = path_1.default.basename(cwd); // ej: ms-company
    const serviceName = serviceDirName.replace(/^ms-/, ""); // ej: company
    const git = (0, simple_git_1.default)({ baseDir: cwd });
    const branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
    // 💡 Determinar entorno basado en el nombre de la rama
    let env = "ci";
    let baseBranch = "master";
    if (branch === "development") {
        env = "dev";
        baseBranch = "development";
    }
    else if (branch === "master") {
        env = "ci";
        baseBranch = "master";
    }
    else if (branch.includes("/dev/")) {
        env = "dev";
        baseBranch = "development";
    }
    else if (branch.includes("/ci/")) {
        env = "ci";
        baseBranch = "master";
    }
    return {
        serviceName,
        branch,
        baseBranch,
        env,
    };
}
