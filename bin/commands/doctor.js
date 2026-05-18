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
const chalk_1 = __importDefault(require("chalk"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
function run(cmd) {
    try {
        return (0, child_process_1.execSync)(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    }
    catch {
        return "";
    }
}
function checkNode() {
    const v = run("node --version");
    const major = parseInt((v.match(/v(\d+)/) ?? [])[1] ?? "0");
    return {
        label: "Node.js",
        ok: major >= 18,
        detail: v || "no encontrado",
        fix: major < 18 ? "Actualizar a Node 18+" : undefined,
    };
}
function checkPython() {
    const v = run("python --version") || run("python3 --version");
    const major = parseInt((v.match(/Python (\d+)/) ?? [])[1] ?? "0");
    return {
        label: "Python",
        ok: major >= 3,
        detail: v || "no encontrado",
        fix: major < 3 ? "Instalar Python 3.x" : undefined,
    };
}
function checkClaude() {
    const v = run("claude --version");
    return {
        label: "Claude CLI",
        ok: !!v,
        detail: v || "no instalado",
        fix: !v ? "npm install -g @anthropic-ai/claude-code" : undefined,
    };
}
function checkAwsCli() {
    const v = run("aws --version");
    return {
        label: "AWS CLI",
        ok: !!v,
        detail: v || "no instalado",
        fix: !v ? "https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html" : undefined,
    };
}
function checkAwsCreds() {
    const result = run("aws sts get-caller-identity --output text --query Account");
    return {
        label: "AWS credentials",
        ok: !!result && !result.includes("error"),
        detail: result ? `Account: ${result}` : "sin credenciales configuradas",
        fix: !result ? "Ejecutar: aws configure" : undefined,
    };
}
function checkJira() {
    const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
    if (!fs.existsSync(settingsPath)) {
        return {
            label: "Jira credentials",
            ok: false,
            detail: "~/.claude/settings.json no existe",
            fix: "Crear settings.json con sección mcpServers.atlassian.env",
        };
    }
    try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
        const env = settings?.mcpServers?.atlassian?.env ?? {};
        const hasAll = env.ATLASSIAN_BASE_URL && env.ATLASSIAN_EMAIL && env.ATLASSIAN_API_TOKEN;
        return {
            label: "Jira credentials",
            ok: !!hasAll,
            detail: hasAll
                ? `${env.ATLASSIAN_EMAIL} @ ${env.ATLASSIAN_BASE_URL}`
                : "Faltan campos en mcpServers.atlassian.env",
            fix: !hasAll ? "Agregar ATLASSIAN_BASE_URL, ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN" : undefined,
        };
    }
    catch {
        return { label: "Jira credentials", ok: false, detail: "settings.json inválido", fix: "Verificar formato JSON" };
    }
}
function checkConfigProperties() {
    const defaultPath = path.join(os.homedir(), "Documents", "ms-g66", "ms-config-properties");
    const exists = fs.existsSync(defaultPath);
    return {
        label: "ms-config-properties",
        ok: exists,
        detail: exists ? defaultPath : "no encontrado en ruta por defecto",
        fix: !exists ? `Clonar en ${defaultPath} o ejecutar: g66 setup` : undefined,
    };
}
function checkGit() {
    const name = run("git config --global user.name");
    const email = run("git config --global user.email");
    const ok = !!(name && email);
    return {
        label: "Git config",
        ok,
        detail: ok ? `${name} <${email}>` : "user.name o user.email no configurado",
        fix: !ok ? "git config --global user.name 'Tu Nombre' && git config --global user.email 'tu@email.com'" : undefined,
    };
}
function checkAiContext() {
    const ctx = path.join(os.homedir(), "Documents", "ms-g66", "ai-context");
    const exists = fs.existsSync(ctx);
    return {
        label: "ai-context workspace",
        ok: exists,
        detail: exists ? ctx : "no encontrado",
        fix: !exists ? "Clonar el repo de ai-context en ~/Documents/ms-g66/ai-context" : undefined,
    };
}
function printCheck(c) {
    const icon = c.ok ? chalk_1.default.green("✓") : chalk_1.default.red("✗");
    const label = chalk_1.default.bold(c.label.padEnd(25));
    const detail = c.ok ? chalk_1.default.dim(c.detail ?? "") : chalk_1.default.yellow(c.detail ?? "");
    console.log(`  ${icon}  ${label} ${detail}`);
    if (!c.ok && c.fix) {
        console.log(`       ${chalk_1.default.dim("Fix:")} ${chalk_1.default.cyan(c.fix)}`);
    }
}
const doctor = new commander_1.Command("doctor")
    .description("🩺 Verifica que el entorno de desarrollo esté correctamente configurado")
    .action(() => {
    console.log(chalk_1.default.bold.blue("\n  G66 Doctor — Verificación de entorno\n"));
    const checks = [
        checkNode(),
        checkPython(),
        checkClaude(),
        checkAwsCli(),
        checkAwsCreds(),
        checkJira(),
        checkConfigProperties(),
        checkAiContext(),
        checkGit(),
    ];
    console.log(chalk_1.default.bold("  Herramientas\n"));
    checks.slice(0, 4).forEach(printCheck);
    console.log(chalk_1.default.bold("\n  Credenciales\n"));
    checks.slice(4, 6).forEach(printCheck);
    console.log(chalk_1.default.bold("\n  Workspace\n"));
    checks.slice(6).forEach(printCheck);
    const failed = checks.filter(c => !c.ok);
    console.log();
    if (failed.length === 0) {
        console.log(chalk_1.default.green.bold("  ✅ Todo OK — el entorno está listo para trabajar.\n"));
    }
    else {
        console.log(chalk_1.default.yellow.bold(`  ⚠️  ${failed.length} problema(s) encontrado(s). Revisá los Fix arriba.\n`));
    }
});
exports.default = doctor;
