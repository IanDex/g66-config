"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDir = ensureDir;
exports.pathExists = pathExists;
exports.copyFileSafe = copyFileSafe;
exports.writeFileSafe = writeFileSafe;
exports.readFileIfExists = readFileIfExists;
exports.removeDirRecursive = removeDirRecursive;
exports.normalizeRepoPath = normalizeRepoPath;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
async function ensureDir(dir) {
    await promises_1.default.mkdir(dir, { recursive: true });
}
async function pathExists(p) {
    try {
        await promises_1.default.access(p);
        return true;
    }
    catch {
        return false;
    }
}
async function copyFileSafe(src, dest) {
    await ensureDir(path_1.default.dirname(dest));
    await promises_1.default.copyFile(src, dest);
}
async function writeFileSafe(filePath, content) {
    await ensureDir(path_1.default.dirname(filePath));
    await promises_1.default.writeFile(filePath, content);
}
async function readFileIfExists(filePath) {
    try {
        return await promises_1.default.readFile(filePath);
    }
    catch {
        return null;
    }
}
async function removeDirRecursive(dir) {
    await promises_1.default.rm(dir, { recursive: true, force: true });
}
function normalizeRepoPath(rel) {
    return rel.split(path_1.default.sep).join("/");
}
