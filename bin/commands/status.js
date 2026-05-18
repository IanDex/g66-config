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
const status = new commander_1.Command("status")
    .description("📋 Pipeline completo de onboarding de un usuario y su empresa")
    .option("-e, --env <env>", "Entorno: dev | ci")
    .option("--email <email>", "Email del usuario")
    .action(async (opts) => {
    const env = opts.env ?? (await inquirer_1.default.prompt([
        { type: "list", name: "env", message: "🌐 Entorno:", choices: ["dev", "ci"], default: "dev" },
    ])).env;
    const email = opts.email ?? (await inquirer_1.default.prompt([
        { type: "input", name: "email", message: "📧 Email del usuario:", validate: (v) => !!v.trim() || "Requerido" },
    ])).email;
    const cmd = `python "${LOGI}" status --env ${env} --email "${email}"`;
    console.log(chalk_1.default.dim(`\n→ ${cmd}\n`));
    try {
        (0, child_process_1.execSync)(cmd, { stdio: "inherit" });
    }
    catch {
        process.exit(1);
    }
});
exports.default = status;
