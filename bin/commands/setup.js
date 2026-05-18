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
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
const SCRIPT = path.join(__dirname, "..", "..", "scripts", "setup_logi.py");
const DEFAULT_CONFIG_PROPS = path.join(os.homedir(), "Documents", "ms-g66", "ms-config-properties");
const setup = new commander_1.Command("setup")
    .description("⚙️  Genera config de logi leyendo credenciales de ms-config-properties")
    .option("--repo <path>", "Ruta a ms-config-properties")
    .option("--service <name>", "Servicio a parsear", "company")
    .option("--dry-run", "Mostrar config generada sin escribir")
    .action(async (opts) => {
    let repo = opts.repo;
    if (!repo) {
        if (fs.existsSync(DEFAULT_CONFIG_PROPS)) {
            repo = DEFAULT_CONFIG_PROPS;
        }
        else {
            const { inputRepo } = await inquirer_1.default.prompt([{
                    type: "input",
                    name: "inputRepo",
                    message: "📁 Ruta local a ms-config-properties:",
                    validate: (v) => {
                        if (!v.trim())
                            return "Requerido";
                        if (!fs.existsSync(v.trim()))
                            return `No existe: ${v.trim()}`;
                        return true;
                    },
                }]);
            repo = inputRepo.trim();
        }
    }
    console.log(chalk_1.default.blue(`\n🔧 Leyendo credenciales desde:\n   ${repo}\n`));
    const pyArgs = ["--repo", repo, "--service", opts.service];
    if (opts.dryRun)
        pyArgs.push("--dry-run");
    const result = (0, child_process_1.spawnSync)("python", [SCRIPT, ...pyArgs], {
        encoding: "utf-8",
        stdio: ["inherit", "pipe", "inherit"],
    });
    if (!result.stdout?.trim()) {
        console.error(chalk_1.default.red("❌ El script no retornó respuesta."));
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
    if (opts.dryRun) {
        console.log(chalk_1.default.yellow("\n[dry-run] Config que se generaría:\n"));
        console.log(chalk_1.default.dim(data.preview));
        return;
    }
    console.log(chalk_1.default.green(`✅ config.py generado en:\n   ${data.path}\n`));
    console.log(chalk_1.default.dim("  g66 token  →  listo para usar"));
});
exports.default = setup;
