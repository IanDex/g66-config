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
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const SCRIPT = path.join(__dirname, "..", "..", "scripts", "start_hu.py");
const start = new commander_1.Command("start")
    .description("🚀 Lee HU de Jira y lanza Claude para implementarla")
    .argument("<hu>", "Código de la HU (ej: AT-108)")
    .option("--repo-id <id>", "ID del repo en ai-context (se infiere del directorio)")
    .option("--print", "Solo imprimir el prompt sin lanzar Claude")
    .action((huCode, opts) => {
    console.log(chalk_1.default.dim(`\n  Leyendo HU ${huCode.toUpperCase()} de Jira...`));
    const pyArgs = [huCode, "--cwd", process.cwd()];
    if (opts.repoId)
        pyArgs.push("--repo-id", opts.repoId);
    const result = (0, child_process_1.spawnSync)("python", [SCRIPT, ...pyArgs], {
        encoding: "utf-8",
        stdio: ["inherit", "pipe", "inherit"],
    });
    if (!result.stdout?.trim()) {
        console.error(chalk_1.default.red("❌ Sin respuesta del script."));
        process.exit(1);
    }
    let data;
    try {
        data = JSON.parse(result.stdout.trim());
    }
    catch {
        console.error(chalk_1.default.red("❌ Respuesta inválida."));
        process.exit(1);
    }
    if (!data.ok) {
        console.error(chalk_1.default.red(`❌ ${data.error}`));
        process.exit(1);
    }
    console.log(chalk_1.default.green(`✅ HU ${data.hu}: ${data.title}\n`));
    if (opts.print) {
        console.log(data.prompt);
        return;
    }
    // Escribir prompt a temp file y al clipboard
    const tmpFile = path.join(os.tmpdir(), `g66-start-${data.hu}.md`);
    fs.writeFileSync(tmpFile, data.prompt, "utf-8");
    try {
        // clip es el clipboard de Windows
        (0, child_process_1.execSync)(`clip < "${tmpFile}"`, { shell: "cmd.exe" });
    }
    catch {
        // fallback: PowerShell Set-Clipboard
        try {
            (0, child_process_1.execSync)(`powershell -Command "Get-Content '${tmpFile}' | Set-Clipboard"`);
        }
        catch { /* silencioso */ }
    }
    console.log(chalk_1.default.cyan("📋 Prompt copiado al clipboard\n"));
    console.log(chalk_1.default.bold("🤖 Lanzando Claude — pegá el prompt con ") + chalk_1.default.bold.yellow("Ctrl+V") + chalk_1.default.bold(" y Enter\n"));
    const claude = (0, child_process_1.spawn)("claude", [], {
        stdio: "inherit",
        shell: false,
    });
    claude.on("error", (err) => {
        console.error(chalk_1.default.red(`❌ No se pudo lanzar Claude: ${err.message}`));
        console.log(chalk_1.default.yellow("💡 Instala Claude Code: npm install -g @anthropic-ai/claude-code"));
        console.log(chalk_1.default.dim(`\n📄 Prompt guardado en: ${tmpFile}`));
        process.exit(1);
    });
    claude.on("exit", (code) => {
        process.exit(code ?? 0);
    });
});
exports.default = start;
