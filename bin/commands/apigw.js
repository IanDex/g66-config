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
const path = __importStar(require("path"));
const SYNC_ALL = path.join(__dirname, "..", "..", "vendor", "apigw", "scripts", "sync_all_envs.ps1");
const SYNC_ONE = path.join(__dirname, "..", "..", "vendor", "apigw", "scripts", "sync_from_aws.ps1");
function git(args) {
    try {
        return (0, child_process_1.execSync)(`git ${args}`, { encoding: "utf-8" }).trim();
    }
    catch {
        return "";
    }
}
function getRepoPath() {
    return git("rev-parse --show-toplevel").replace(/\//g, "\\");
}
function getBranch() {
    return git("rev-parse --abbrev-ref HEAD");
}
function inferHu(branch) {
    // user/env/HU — toma todo lo que viene después del segundo /
    const parts = branch.split("/");
    if (parts.length >= 3)
        return parts.slice(2).join("/").toUpperCase();
    return null;
}
function inferEnvsFromBranch(branch) {
    const parts = branch.split("/");
    const env = parts[1]?.toLowerCase();
    if (env === "ci")
        return "ci";
    if (env === "prod")
        return "prod";
    return "dev";
}
function runPs1(script, args) {
    const argStr = Object.entries(args)
        .map(([k, v]) => `-${k} "${v}"`)
        .join(" ");
    const cmd = `pwsh -ExecutionPolicy Bypass -NoProfile -File "${script}" ${argStr}`;
    console.log(chalk_1.default.dim(`\n→ ${cmd}\n`));
    try {
        (0, child_process_1.execSync)(cmd, { stdio: "inherit" });
    }
    catch {
        process.exit(1);
    }
}
const apigw = new commander_1.Command("apigw")
    .description("🔀 Sincroniza rutas de API Gateway desde el diff del MS actual")
    .option("--hu <code>", "Código HU (ej: AT-108) — se infiere de la rama si no se pasa")
    .option("--envs <envs>", "Entornos a sincronizar: dev,ci,prod (default: todos)")
    .option("--only <env>", "Un solo entorno (dev | ci | prod)")
    .action(async (opts) => {
    const branch = getBranch();
    const repo = getRepoPath();
    if (!repo) {
        console.error(chalk_1.default.red("❌ No estás dentro de un repositorio git."));
        process.exit(1);
    }
    // HU
    const inferredHu = inferHu(branch);
    let hu = opts.hu ?? inferredHu;
    if (!hu) {
        const ans = await inquirer_1.default.prompt([{
                type: "input",
                name: "hu",
                message: "🔖 Código HU (ej: AT-108):",
                validate: (v) => !!v.trim() || "Requerido",
            }]);
        hu = ans.hu.trim().toUpperCase();
    }
    // Envs — inferir de la rama; solo preguntar si la rama no tiene formato user/env/HU
    const inferredEnv = inferEnvsFromBranch(branch);
    let envs = opts.envs ?? (opts.only ? opts.only : null);
    if (!envs) {
        const branchHasEnv = branch.split("/").length >= 3;
        if (branchHasEnv) {
            envs = inferredEnv;
        }
        else {
            const { selected } = await inquirer_1.default.prompt([{
                    type: "checkbox",
                    name: "selected",
                    message: "🌐 Entornos a sincronizar:",
                    choices: [
                        { name: "dev  → development", value: "dev", checked: inferredEnv === "dev" },
                        { name: "ci   → master", value: "ci", checked: inferredEnv === "ci" },
                        { name: "prod → release", value: "prod", checked: inferredEnv === "prod" },
                    ],
                }]);
            if (!selected.length) {
                console.log(chalk_1.default.yellow("Sin entornos seleccionados."));
                return;
            }
            envs = selected.join(",");
        }
    }
    console.log(chalk_1.default.blue(`\n📦 Repo: ${repo}`));
    console.log(chalk_1.default.blue(`🔖 HU:   ${hu}`));
    console.log(chalk_1.default.blue(`🌐 Envs: ${envs}\n`));
    if (opts.only) {
        runPs1(SYNC_ONE, { Repo: repo, Env: opts.only, Hu: hu, PrepareConfig: "" });
    }
    else {
        runPs1(SYNC_ALL, { Repo: repo, Hu: hu, Envs: envs });
    }
});
exports.default = apigw;
