"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDeveloperConfig = getDeveloperConfig;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const CONFIG_PATH = path_1.default.join(os_1.default.homedir(), '.', '.g66config.json');
function getDeveloperConfig() {
    if (!fs_1.default.existsSync(CONFIG_PATH)) {
        throw new Error('⚠️ No se encontró la configuración. Ejecutá `g66 init` primero.');
    }
    const raw = fs_1.default.readFileSync(CONFIG_PATH, 'utf-8');
    console.log(JSON.parse(raw));
    return JSON.parse(raw);
}
