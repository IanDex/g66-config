import { Command } from "commander";
import { runPromote } from "../services/promote-service";

const promote = new Command("promote");

promote
  .description(
    "Cherry-pickea un commit entre ramas locales (checkout, pull, push)",
  )
  .option(
    "--dry-run",
    "Simula el flujo sin ejecutar operaciones que modifiquen el repo",
    false,
  )
  .action(async (opts: { dryRun?: boolean }) => {
    try {
      await runPromote(process.cwd(), { dryRun: Boolean(opts.dryRun) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n❌ ${msg}\n`);
      process.exitCode = 1;
    }
  });

export default promote;
