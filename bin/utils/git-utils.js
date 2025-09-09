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
exports.isBranchPushed = isBranchPushed;
exports.hasCommitsToPush = hasCommitsToPush;
exports.getCurrentBranch = getCurrentBranch;
exports.inferEnvironment = inferEnvironment;
exports.getRepoName = getRepoName;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
function isBranchPushed(branch) {
    try {
        const result = (0, child_process_1.execSync)(`git ls-remote --heads origin ${branch}`).toString().trim();
        return result.length > 0;
    }
    catch {
        return false;
    }
}
function hasCommitsToPush(baseBranch) {
    try {
        const result = (0, child_process_1.execSync)(`git log origin/${baseBranch}..HEAD --oneline`).toString().trim();
        return result.length > 0;
    }
    catch {
        return false;
    }
}
function getCurrentBranch() {
    try {
        return (0, child_process_1.execSync)('git rev-parse --abbrev-ref HEAD').toString().trim();
    }
    catch (err) {
        throw new Error('⚠️ No se pudo obtener la rama actual. ¿Estás en un repo Git?');
    }
}
function inferEnvironment(branch) {
    if (branch.includes('/ci/') || branch.includes('ci'))
        return 'ci';
    return 'dev';
}
function getRepoName() {
    try {
        const remoteUrl = (0, child_process_1.execSync)('git config --get remote.origin.url').toString().trim();
        const repoName = path.basename(remoteUrl, '.git');
        return repoName;
    }
    catch (err) {
        throw new Error('⚠️ No se pudo obtener el nombre del repositorio. ¿Está configurado el remote?');
    }
}
