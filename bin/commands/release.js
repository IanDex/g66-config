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
const SCRIPT = path.join(__dirname, "..", "..", "scripts", "release_context.py");
function callScript(pyArgs) {
    const result = (0, child_process_1.spawnSync)("python", [SCRIPT, ...pyArgs], {
        encoding: "utf-8",
        stdio: ["inherit", "pipe", "pipe"],
    });
    const raw = result.stdout?.trim() || result.stderr?.trim();
    if (!raw)
        return { data: null, ok: false };
    try {
        const data = JSON.parse(raw);
        return { data, ok: !!data };
    }
    catch {
        return { data: null, ok: false };
    }
}
const release = new commander_1.Command("release")
    .description("🚀 Genera changelog, bump version y crea PR master→release en CodeCommit")
    .option("--region <region>", "AWS region", "us-east-1")
    .option("--version <ver>", "Nueva versión (ej: 2.1.0); si no se pasa, bump patch automático")
    .option("--dry-run", "Solo mostrar el changelog sin crear PR ni modificar pom.xml")
    .action(async (opts) => {
    const cwd = process.cwd();
    console.log(chalk_1.default.dim(`\n  Analizando commits para release en ${path.basename(cwd)}...`));
    const baseArgs = ["--cwd", cwd, "--region", opts.region];
    if (opts.version)
        baseArgs.push("--version", opts.version);
    // Dry-run preview
    const { data: preview, ok } = callScript([...baseArgs, "--dry-run"]);
    if (!ok || !preview) {
        console.error(chalk_1.default.red("❌ Error al analizar el repo."));
        process.exit(1);
    }
    if (!preview.ok) {
        console.error(chalk_1.default.red(`❌ ${preview.error}`));
        process.exit(1);
    }
    // Mostrar resumen
    console.log(chalk_1.default.bold.cyan(`\n📦 Release preview\n`));
    console.log(`  ${chalk_1.default.bold("Repo:")}     ${preview.repo}`);
    console.log(`  ${chalk_1.default.bold("Versión:")}  ${chalk_1.default.dim(preview.current_version)} → ${chalk_1.default.green(preview.new_version)}`);
    console.log(`  ${chalk_1.default.bold("Commits:")}  ${preview.commit_count}`);
    console.log(`  ${chalk_1.default.bold("HUs:")}      ${preview.hu_list.join(", ") || "ninguna detectada"}`);
    console.log();
    console.log(chalk_1.default.bold("📋 Changelog:\n"));
    console.log(chalk_1.default.dim(preview.changelog));
    if (opts.dryRun) {
        console.log(chalk_1.default.yellow("\n[dry-run] Sin cambios.\n"));
        return;
    }
    const { confirm } = await inquirer_1.default.prompt([
        {
            type: "list",
            name: "confirm",
            message: `¿Crear release v${preview.new_version}? (bump pom.xml → push → PR master→release → Jira)`,
            choices: [
                { name: "✅ Sí, crear release", value: "yes" },
                { name: "❌ Cancelar", value: "no" },
            ],
        },
    ]);
    if (confirm !== "yes") {
        console.log(chalk_1.default.gray("\n🚫 Cancelado.\n"));
        return;
    }
    console.log(chalk_1.default.dim("\n  Ejecutando pipeline de release..."));
    const { data: result, ok: fullOk } = callScript(baseArgs);
    if (!fullOk || !result?.ok) {
        console.error(chalk_1.default.red("❌ Pipeline de release falló."));
        process.exit(1);
    }
    console.log(chalk_1.default.green(`\n✅ pom.xml actualizado a v${result.new_version}`));
    console.log(chalk_1.default.green(`✅ Push a origin/${result.repo}`));
    if (result.pr_url) {
        console.log(chalk_1.default.green(`✅ PR creado: ${chalk_1.default.cyan(result.pr_url)}`));
    }
    else {
        console.log(chalk_1.default.yellow("⚠️  PR no pudo crearse en CodeCommit (verificar AWS CLI)."));
    }
    if (result.jira_updated.length > 0) {
        console.log(chalk_1.default.green(`✅ Jira actualizado: ${result.jira_updated.join(", ")}`));
    }
    console.log();
});
exports.default = release;
