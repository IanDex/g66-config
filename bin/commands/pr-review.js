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
const SCRIPT = path.join(__dirname, "..", "..", "scripts", "pr_review.py");
function inferRepo() {
    try {
        return path.basename((0, child_process_1.execSync)("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim());
    }
    catch {
        return null;
    }
}
function inferPrFromBranch(region, repo) {
    try {
        const branch = (0, child_process_1.execSync)("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
        const result = (0, child_process_1.spawnSync)("aws", ["codecommit", "list-pull-requests", "--repository-name", repo,
            "--pull-request-status", "OPEN", "--region", region], { encoding: "utf-8" });
        if (result.status !== 0)
            return null;
        const ids = JSON.parse(result.stdout).pullRequestIds ?? [];
        for (const id of ids) {
            const detail = (0, child_process_1.spawnSync)("aws", ["codecommit", "get-pull-request", "--pull-request-id", id, "--region", region], { encoding: "utf-8" });
            if (detail.status !== 0)
                continue;
            const pr = JSON.parse(detail.stdout).pullRequest;
            for (const t of pr.pullRequestTargets ?? []) {
                const src = t.sourceReference?.replace("refs/heads/", "");
                if (src === branch)
                    return id;
            }
        }
    }
    catch {
        return null;
    }
    return null;
}
const prReview = new commander_1.Command("pr-review")
    .description("🔍 Review de PR con análisis estático + IA contra lineamientos G66")
    .option("--pr <id>", "ID del PR en CodeCommit (se infiere de la rama si omitido)")
    .option("--repo <name>", "Nombre del repositorio (se infiere del directorio)")
    .option("--region <region>", "AWS region", "us-east-1")
    .option("--lineamientos <path>", "Ruta a los lineamientos G66")
    .option("--dry-run", "Solo analizar diff sin llamar a la IA")
    .action(async (opts) => {
    const repo = opts.repo ?? inferRepo();
    if (!repo) {
        console.error(chalk_1.default.red("❌ No se pudo inferir el repositorio. Usa --repo."));
        process.exit(1);
    }
    let prId = opts.pr;
    if (!prId) {
        console.log(chalk_1.default.dim("  Buscando PR abierto para la rama actual..."));
        prId = inferPrFromBranch(opts.region, repo);
        if (!prId) {
            console.error(chalk_1.default.red("❌ No se encontró PR abierto para esta rama. Usa --pr <id>."));
            process.exit(1);
        }
        console.log(chalk_1.default.blue(`  PR inferido: #${prId}`));
    }
    console.log(chalk_1.default.blue(`\n📋 Revisando PR #${prId} en ${repo}...\n`));
    console.log(chalk_1.default.dim("  Analizando diff..."));
    const pyArgs = ["--pr", prId, "--repo", repo, "--region", opts.region];
    if (opts.lineamientos)
        pyArgs.push("--lineamientos", opts.lineamientos);
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
        console.error(chalk_1.default.red("❌ Respuesta inválida del script."));
        process.exit(1);
    }
    if (!data.ok) {
        console.error(chalk_1.default.red(`❌ ${data.error}`));
        process.exit(1);
    }
    if (opts.dryRun) {
        console.log(chalk_1.default.yellow("\n[dry-run]"));
        console.log(`  Diff lines: ${data.diff_lines}`);
        console.log(`  Static findings: ${data.static_findings}`);
        return;
    }
    const scoreColor = data.score >= 80 ? chalk_1.default.green : data.score >= 60 ? chalk_1.default.yellow : chalk_1.default.red;
    console.log(chalk_1.default.bold.cyan(`\n📊 Score: ${scoreColor(data.score + "%")}`));
    console.log(`  🚨 HIGH:   ${data.high}`);
    console.log(`  ⚠️  MEDIUM: ${data.medium}`);
    console.log(`  🧠 LOW:    ${data.low}`);
    console.log(`  Total:    ${data.findings} hallazgo(s)\n`);
    console.log(chalk_1.default.bold(`📝 PR: ${data.pr_title}`));
    console.log(chalk_1.default.green(`\n✅ Reporte guardado en:\n   ${data.report_path}\n`));
});
exports.default = prReview;
