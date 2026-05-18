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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const child_process_1 = require("child_process");
const inquirer_1 = __importDefault(require("inquirer"));
const chalk_1 = __importDefault(require("chalk"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const G66_CONFIG = path.join(os.homedir(), ".g66-config.json");
function getOrSavePrefix() {
    let cfg = {};
    try {
        cfg = JSON.parse(fs.readFileSync(G66_CONFIG, "utf-8"));
    }
    catch { /* ignorar */ }
    if (cfg.branch_prefix)
        return cfg.branch_prefix;
    return "";
}
function savePrefix(prefix) {
    let cfg = {};
    try {
        cfg = JSON.parse(fs.readFileSync(G66_CONFIG, "utf-8"));
    }
    catch { /* ignorar */ }
    cfg.branch_prefix = prefix;
    fs.writeFileSync(G66_CONFIG, JSON.stringify(cfg, null, 2), "utf-8");
}
const ENV_BRANCH = {
    dev: "development",
    ci: "master",
    prod: "release",
};
const nb = new commander_1.Command("nb")
    .description("🌿 Crear nueva rama cv/{env}/{hu} y hacer checkout")
    .argument("<env>", "Ambiente: dev | ci | prod")
    .argument("<hu>", "Código de HU (ej: AT-110)")
    .action(async (env, hu) => {
    const base = ENV_BRANCH[env.toLowerCase()];
    if (!base) {
        console.error(chalk_1.default.red(`❌ Ambiente desconocido: '${env}'. Usar: dev | ci | prod`));
        process.exit(1);
    }
    let prefix = getOrSavePrefix();
    if (!prefix) {
        const ans = await inquirer_1.default.prompt([{
                type: "input", name: "prefix",
                message: "¿Cuál es tu prefijo de rama? (ej: cv, juan, jl):",
                validate: (v) => v.trim().length > 0 || "No puede estar vacío",
            }]);
        prefix = ans.prefix.trim().toLowerCase();
        savePrefix(prefix);
        console.log(chalk_1.default.green(`  ✅ Guardado en ~/.g66-config.json\n`));
    }
    const branch = `${prefix}/${env.toLowerCase()}/${hu.toUpperCase()}`;
    try {
        console.log(chalk_1.default.dim(`\n  → git checkout ${base} && git pull && git checkout -b ${branch}\n`));
        (0, child_process_1.execSync)(`git checkout ${base}`, { stdio: "inherit" });
        (0, child_process_1.execSync)(`git pull`, { stdio: "inherit" });
        (0, child_process_1.execSync)(`git checkout -b ${branch}`, { stdio: "inherit" });
        console.log(chalk_1.default.green(`\n  ✅ Rama creada: ${chalk_1.default.bold(branch)}\n`));
    }
    catch {
        process.exit(1);
    }
});
exports.default = nb;
