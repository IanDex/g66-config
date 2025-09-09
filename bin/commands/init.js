"use strict";
// src/commands/init.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runInit = runInit;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const inquirer_1 = __importDefault(require("inquirer"));
const CONFIG_PATH = path_1.default.join(os_1.default.homedir(), ".g66config.json");
async function runInit() {
    const questions = [
        {
            type: "input",
            name: "author",
            message: "👤 Nombre del desarrollador:",
            validate: (input) => input.trim() !== "" || "Este campo es obligatorio.",
        },
        {
            type: "input",
            name: "email",
            message: "✉️  Email del desarrollador (opcional):",
        },
        {
            type: "input",
            name: "defaultBranchPrefix",
            message: "🏷️  Prefijo default para ramas (ej. PAC-, ACME-):",
        },
        {
            type: "input",
            name: "jiraUrl",
            message: "🌐 URL base de Jira (opcional):",
            default: "https://global66.atlassian.net/browse/",
        },
        {
            type: "confirm",
            name: "autoPush",
            message: "🚀 ¿Deseas hacer `git push` automáticamente después del commit?",
            default: true,
        },
    ];
    const config = await inquirer_1.default.prompt(questions);
    fs_1.default.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log("\n✅ Configuración guardada exitosamente en:");
    console.log(CONFIG_PATH);
}
