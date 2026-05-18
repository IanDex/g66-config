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
const LOGI = path.join(__dirname, "..", "..", "logi", "cli.py");
function pyJson(args) {
    const result = (0, child_process_1.spawnSync)("python", [LOGI, ...args], { encoding: "utf-8" });
    if (result.status !== 0)
        throw new Error(result.stderr || "Error en CLI logi");
    return JSON.parse(result.stdout.trim());
}
async function askEnv() {
    const { env } = await inquirer_1.default.prompt([
        { type: "list", name: "env", message: "🌐 Entorno:", choices: ["dev", "ci"], default: "dev" },
    ]);
    return env;
}
const company = new commander_1.Command("company")
    .description("🏢 Vista completa de una compañía y sus usuarios")
    .option("-e, --env <env>", "Entorno: dev | ci")
    .option("--id <id>", "ID de la compañía")
    .option("--login", "Hacer login con un usuario de la compañía")
    .option("--no-copy", "No copiar idToken al clipboard (requiere --login)")
    .option("--decode", "Mostrar JWT claims (requiere --login)")
    .action(async (opts) => {
    const env = opts.env ?? (await askEnv());
    let companyId = opts.id;
    if (!companyId) {
        const { id } = await inquirer_1.default.prompt([
            { type: "input", name: "id", message: "🏢 ID de compañía:", validate: (v) => !!v.trim() || "Requerido" },
        ]);
        companyId = id.trim();
    }
    // Mostrar info de la empresa
    const cmd = `python "${LOGI}" company --env ${env} --id ${companyId}`;
    console.log(chalk_1.default.dim(`\n→ ${cmd}\n`));
    try {
        (0, child_process_1.execSync)(cmd, { stdio: "inherit" });
    }
    catch {
        process.exit(1);
    }
    if (!opts.login)
        return;
    // Seleccionar usuario y hacer login
    const userList = pyJson([
        "users", "--env", env, "--company-id", String(companyId), "--json",
    ]);
    if (!userList.length) {
        console.log(chalk_1.default.yellow("Sin usuarios activos."));
        return;
    }
    let email;
    if (userList.length === 1) {
        email = userList[0].email;
        console.log(chalk_1.default.dim(`\n  Usuario: ${email}`));
    }
    else {
        const ans = await inquirer_1.default.prompt([
            {
                type: "list",
                name: "email",
                message: "👤 Usuario para login:",
                choices: userList.map((u) => ({
                    name: `${u.email}${u.is_legal_representative ? "  ★ rep legal" : ""}`,
                    value: u.email,
                })),
            },
        ]);
        email = ans.email;
    }
    const tokenArgs = ["--env", env, "--email", email];
    if (opts.decode)
        tokenArgs.push("--decode");
    const tokenCmd = `python "${LOGI}" token ${tokenArgs.join(" ")}`;
    console.log(chalk_1.default.dim(`\n→ ${tokenCmd}\n`));
    try {
        (0, child_process_1.execSync)(tokenCmd, { stdio: "inherit" });
    }
    catch {
        process.exit(1);
    }
});
exports.default = company;
