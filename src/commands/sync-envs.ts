import { Command } from "commander";
import chalk from "chalk";
import {
  runEnvSync,
  type EnvSyncTarget,
} from "../services/env-sync.service";

const syncEnvs = new Command("sync-envs");

syncEnvs
  .description(
    "Homologa master (CI) y development (DEV) con release vía ramas temporales y PRs (release = fuente de verdad)",
  )
  .option(
    "--dry-run",
    "Solo analizar diferencias y mostrar el plan, sin fetch ni cambios en el repo",
    false,
  )
  .option(
    "--only <branch>",
    "Procesar solo master o development",
  )
  .option("-v, --verbose", "Log detallado", false)
  .action(
    async (opts: { dryRun?: boolean; only?: string; verbose?: boolean }) => {
      const rawOnly = opts.only?.trim();
      let only: EnvSyncTarget | undefined;
      if (rawOnly) {
        if (rawOnly !== "master" && rawOnly !== "development") {
          console.error(
            chalk.red(
              '--only debe ser "master" o "development".',
            ),
          );
          process.exitCode = 1;
          return;
        }
        only = rawOnly;
      }
      try {
        await runEnvSync({
          cwd: process.cwd(),
          dryRun: Boolean(opts.dryRun),
          only,
          verbose: Boolean(opts.verbose),
        });
      } catch {
        process.exitCode = 1;
      }
    },
  );

export default syncEnvs;
