"use strict";
// src/utils/loadConfig.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadG66Config = loadG66Config;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const CONFIG_PATH = path_1.default.join(os_1.default.homedir(), ".g66config.json");
function loadG66Config() {
    if (!fs_1.default.existsSync(CONFIG_PATH))
        return {};
    const raw = fs_1.default.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
}
