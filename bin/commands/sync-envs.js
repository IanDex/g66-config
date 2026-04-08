"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const env_sync_service_1 = require("../services/env-sync.service");
const syncEnvs = new commander_1.Command("sync-envs");
syncEnvs
    .description("Homologa master (CI) y development (DEV) con release vía ramas temporales y PRs (release = fuente de verdad)")
    .option("--dry-run", "Solo analizar diferencias y mostrar el plan, sin fetch ni cambios en el repo", false)
    .option("--only <branch>", "Procesar solo master o development")
    .option("-v, --verbose", "Log detallado", false)
    .action(async (opts) => {
    const rawOnly = opts.only?.trim();
    let only;
    if (rawOnly) {
        if (rawOnly !== "master" && rawOnly !== "development") {
            console.error(chalk_1.default.red('--only debe ser "master" o "development".'));
            process.exitCode = 1;
            return;
        }
        only = rawOnly;
    }
    try {
        await (0, env_sync_service_1.runEnvSync)({
            cwd: process.cwd(),
            dryRun: Boolean(opts.dryRun),
            only,
            verbose: Boolean(opts.verbose),
        });
    }
    catch {
        process.exitCode = 1;
    }
});
exports.default = syncEnvs;
