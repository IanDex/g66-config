"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveConfigRepoPath = resolveConfigRepoPath;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const inquirer_1 = __importDefault(require("inquirer"));
const os_1 = __importDefault(require("os"));
const CONFIG_FILE_PATH = path_1.default.join(os_1.default.homedir(), ".g66-config.json");
async function resolveConfigRepoPath() {
    if (fs_1.default.existsSync(CONFIG_FILE_PATH)) {
        const content = fs_1.default.readFileSync(CONFIG_FILE_PATH, "utf-8");
        const config = JSON.parse(content);
        if (config.configRepoPath && fs_1.default.existsSync(config.configRepoPath)) {
            return config.configRepoPath;
        }
    }
    console.log("❓ No se encontró la ruta al repositorio ms-config-properties.");
    const answers = await inquirer_1.default.prompt([
        {
            type: "input",
            name: "configRepoPath",
            message: "🛠  Ingresa la ruta absoluta local del repositorio ms-config-properties:",
            validate: (input) => fs_1.default.existsSync(input) || "❌ Ruta no válida",
        },
    ]);
    const config = { configRepoPath: answers.configRepoPath };
    fs_1.default.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2), "utf-8");
    console.log("✅ Ruta guardada correctamente.\n");
    return config.configRepoPath;
}
