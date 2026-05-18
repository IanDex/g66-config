import { Command } from "commander";
import { spawnSync, execSync } from "child_process";
import inquirer from "inquirer";
import chalk from "chalk";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const MEMBERS_CACHE = path.join(os.homedir(), ".g66-slack-members.json");

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "slack_context.py");

function callScript(pyArgs: string[]): { data: any; ok: boolean } {
  const result = spawnSync("python", [SCRIPT, ...pyArgs], {
    encoding: "utf-8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  const raw = result.stdout?.trim() || result.stderr?.trim();
  if (!raw) return { data: null, ok: false };
  try {
    const data = JSON.parse(raw);
    return { data, ok: !!data };
  } catch {
    return { data: null, ok: false };
  }
}

const slack = new Command("slack")
  .description("💬 Interacción con tableros Slack Lists")
  .addCommand(
    new Command("test")
      .description("Verificar token y conexión con el canal")
      .action(() => {
        const { data, ok } = callScript(["--action", "test"]);
        if (!ok || !data?.ok) {
          console.error(chalk.red(`❌ ${data?.error ?? "Error al conectar con Slack."}`));
          process.exit(1);
        }
        console.log(chalk.green(`\n  ✅ Conectado como ${chalk.bold(data.user)} (${data.team})`));
        console.log(chalk.dim(`  Canal: #${data.channel} (${data.channel_id})\n`));
      })
  )
  .addCommand(
    new Command("discover")
      .description("Descubrir tableros/lists disponibles en el canal")
      .action(() => {
        console.log(chalk.dim("\n  Explorando el canal...\n"));
        const { data, ok } = callScript(["--action", "discover"]);
        if (!ok || !data?.ok) {
          console.error(chalk.red("❌ Error al explorar el canal."));
          process.exit(1);
        }
        console.log(chalk.bold("  Respuesta de APIs:\n"));
        console.log(JSON.stringify(data.discovery, null, 2));
        console.log();
      })
  )
  .addCommand(
    new Command("users")
      .description("Listar miembros del canal de devs (con su Slack user ID)")
      .option("--refresh", "Forzar actualización desde Slack (ignorar cache)")
      .action((opts) => {
        let members: { id: string; name: string; display_name: string }[];
        let updatedAt: string;
        let fromCache = false;

        if (!opts.refresh && fs.existsSync(MEMBERS_CACHE)) {
          const cache = JSON.parse(fs.readFileSync(MEMBERS_CACHE, "utf-8"));
          members   = cache.members || [];
          updatedAt = new Date(cache.updated_at).toLocaleString("es-CL");
          fromCache = true;
        } else {
          const { data, ok } = callScript(["--action", "users"]);
          if (!ok || !data?.ok) {
            console.error(chalk.red(`❌ ${data?.error ?? "Error al obtener miembros."}`));
            process.exit(1);
          }
          members   = data.members || [];
          updatedAt = new Date().toLocaleString("es-CL");
          const cache = { updated_at: new Date().toISOString(), members };
          fs.writeFileSync(MEMBERS_CACHE, JSON.stringify(cache, null, 2), "utf-8");
        }

        const source = fromCache ? chalk.dim("(cache local)") : chalk.yellow("(actualizado desde Slack)");
        console.log(chalk.bold(`\n  Miembros del canal (${members.length}) — ${updatedAt} ${source}\n`));
        for (const m of members) {
          console.log(`  ${chalk.cyan(m.id.padEnd(14))} ${m.name}${m.display_name && m.display_name !== m.name ? chalk.dim(` (@${m.display_name})`) : ""}`);
        }
        console.log();
      })
  )
  .addCommand(
    new Command("add")
      .description("Agregar un item al tablero")
      .option("--hu <hu>",             "Código de HU (ej: AT-110)")
      .option("--pr-url <url>",        "URL del PR en CodeCommit")
      .option("--title <title>",       "Título del item")
      .option("--assignee-id <id>",    "Slack user ID del asignado (omitir para seleccionar)")
      .option("--list-id <id>",        "ID del tablero/list de Slack")
      .action(async (opts) => {
        let { hu, prUrl, title, assigneeId, listId } = opts;

        // Inferir HU desde la rama
        if (!hu) {
          try {
            const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
            const match  = branch.match(/([A-Z]{2,6}-\d+)/);
            if (match) hu = match[1];
          } catch { /* fuera de un repo git */ }
        }
        if (!hu) {
          const ans = await inquirer.prompt([{
            type: "input", name: "hu",
            message: "¿Código de la HU? (ej: AT-110)",
          }]);
          hu = ans.hu.trim().toUpperCase();
        }

        // Detectar env desde la rama
        let env = "";
        try {
          const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
          const envMatch = branch.match(/^[^/]+\/([^/]+)\//);
          if (envMatch) env = envMatch[1]; // dev | ci | prod
        } catch { /* ignorar */ }

        // PR URL fake para pruebas si no se provee
        if (!prUrl) {
          prUrl = `https://us-east-1.console.aws.amazon.com/codesuite/codecommit/repositories/ms-business-api/pull-requests/999/details`;
        }

        // Verificar / pedir my_user_id
        const G66_CONFIG = path.join(os.homedir(), ".g66-config.json");
        let g66cfg: any = {};
        try { g66cfg = JSON.parse(fs.readFileSync(G66_CONFIG, "utf-8")); } catch { /* ignorar */ }
        let myUserId: string = g66cfg?.slack?.my_user_id || "";

        if (!myUserId) {
          console.log(chalk.yellow("\n  Tu usuario de Slack no está configurado."));
          console.log("  1. En Slack, click en tu foto de perfil → 'Perfil'");
          console.log("  2. Click en ⋮ (tres puntos) → 'Copiar ID de miembro'\n");
          const ansId = await inquirer.prompt([{
            type: "input", name: "userId",
            message: "Pega tu Slack user ID (ej: U0XXXXXXXXX):",
            validate: (v: string) => v.trim().startsWith("U") || "ID inválido (debe empezar con U)",
          }]);
          myUserId = ansId.userId.trim();
          g66cfg.slack = { ...g66cfg.slack, my_user_id: myUserId };
          fs.writeFileSync(G66_CONFIG, JSON.stringify(g66cfg, null, 2), "utf-8");
          console.log(chalk.green("  ✅ Guardado en ~/.g66-config.json\n"));
        }

        // Comentario opcional
        let comments = "";
        const ansComments = await inquirer.prompt([{
          type: "input", name: "comments",
          message: "¿Algún comentario? (Enter para omitir)",
        }]);
        comments = ansComments.comments.trim();

        // Seleccionar assignee desde cache
        if (!assigneeId) {
          type Member = { id: string; name: string; display_name: string };
          let members: Member[] = [];
          if (fs.existsSync(MEMBERS_CACHE)) {
            const cache = JSON.parse(fs.readFileSync(MEMBERS_CACHE, "utf-8"));
            members = cache.members || [];
          }

          if (members.length === 0) {
            console.log(chalk.yellow("  ⚠️  Sin cache de miembros. Correr: g66 slack users --refresh"));
          } else {
            const choices = members.map((m) => ({
              name: m.name + (m.display_name && m.display_name !== m.name ? ` (@${m.display_name})` : ""),
              value: m.id,
            }));
            choices.push({ name: chalk.dim("— Sin asignar —"), value: "" });

            const ans = await inquirer.prompt([{
              type: "list", name: "assignee",
              message: "¿A quién asignar?",
              choices,
            }]);
            assigneeId = ans.assignee;
          }
        }

        const fullTitle = title || (hu ? `[${hu}] PR` : "PR");
        const args = ["--action", "add"];
        if (hu)    args.push("--hu",    hu);
        if (prUrl) args.push("--pr-url", prUrl);
        args.push("--title", fullTitle);
        if (assigneeId) args.push("--assignee-id", assigneeId);
        if (comments)   args.push("--comments",    comments);
        if (env)        args.push("--env",         env);
        if (listId)     args.push("--list-id",     listId);

        const { data, ok } = callScript(args);
        if (!ok || !data?.ok) {
          console.error(chalk.red(`❌ ${data?.error ?? "Error al agregar item."}`));
          process.exit(1);
        }

        console.log(chalk.green(`\n  ✅ Item agregado via ${chalk.bold(data.method)}`));
        if (data.ts) console.log(chalk.dim(`  ts: ${data.ts}`));
        console.log();
      })
  );

export default slack;
