"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const promote_service_1 = require("../services/promote-service");
const promote = new commander_1.Command("promote");
promote
    .description("Cherry-pickea un commit entre ramas locales (checkout, pull, push)")
    .option("--dry-run", "Simula el flujo sin ejecutar operaciones que modifiquen el repo", false)
    .action(async (opts) => {
    try {
        await (0, promote_service_1.runPromote)(process.cwd(), { dryRun: Boolean(opts.dryRun) });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n❌ ${msg}\n`);
        process.exitCode = 1;
    }
});
exports.default = promote;
