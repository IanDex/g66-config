import { Command } from "commander";
import { execSync, spawnSync } from "child_process";
import chalk from "chalk";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

interface Check {
  label: string;
  ok: boolean;
  detail?: string;
  fix?: string;
}

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

function checkNode(): Check {
  const v = run("node --version");
  const major = parseInt((v.match(/v(\d+)/) ?? [])[1] ?? "0");
  return {
    label: "Node.js",
    ok: major >= 18,
    detail: v || "no encontrado",
    fix: major < 18 ? "Actualizar a Node 18+" : undefined,
  };
}

function checkPython(): Check {
  const v = run("python --version") || run("python3 --version");
  const major = parseInt((v.match(/Python (\d+)/) ?? [])[1] ?? "0");
  return {
    label: "Python",
    ok: major >= 3,
    detail: v || "no encontrado",
    fix: major < 3 ? "Instalar Python 3.x" : undefined,
  };
}

function checkClaude(): Check {
  const v = run("claude --version");
  return {
    label: "Claude CLI",
    ok: !!v,
    detail: v || "no instalado",
    fix: !v ? "npm install -g @anthropic-ai/claude-code" : undefined,
  };
}

function checkAwsCli(): Check {
  const v = run("aws --version");
  return {
    label: "AWS CLI",
    ok: !!v,
    detail: v || "no instalado",
    fix: !v ? "https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html" : undefined,
  };
}

function checkAwsCreds(): Check {
  const result = run("aws sts get-caller-identity --output text --query Account");
  return {
    label: "AWS credentials",
    ok: !!result && !result.includes("error"),
    detail: result ? `Account: ${result}` : "sin credenciales configuradas",
    fix: !result ? "Ejecutar: aws configure" : undefined,
  };
}

function checkJira(): Check {
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
  } catch {
    return { label: "Jira credentials", ok: false, detail: "settings.json inválido", fix: "Verificar formato JSON" };
  }
}

function checkConfigProperties(): Check {
  const defaultPath = path.join(os.homedir(), "Documents", "ms-g66", "ms-config-properties");
  const exists = fs.existsSync(defaultPath);
  return {
    label: "ms-config-properties",
    ok: exists,
    detail: exists ? defaultPath : "no encontrado en ruta por defecto",
    fix: !exists ? `Clonar en ${defaultPath} o ejecutar: g66 setup` : undefined,
  };
}

function checkGit(): Check {
  const name  = run("git config --global user.name");
  const email = run("git config --global user.email");
  const ok    = !!(name && email);
  return {
    label: "Git config",
    ok,
    detail: ok ? `${name} <${email}>` : "user.name o user.email no configurado",
    fix: !ok ? "git config --global user.name 'Tu Nombre' && git config --global user.email 'tu@email.com'" : undefined,
  };
}

function checkAiContext(): Check {
  const ctx = path.join(os.homedir(), "Documents", "ms-g66", "ai-context");
  const exists = fs.existsSync(ctx);
  return {
    label: "ai-context workspace",
    ok: exists,
    detail: exists ? ctx : "no encontrado",
    fix: !exists ? "Clonar el repo de ai-context en ~/Documents/ms-g66/ai-context" : undefined,
  };
}

function printCheck(c: Check): void {
  const icon   = c.ok ? chalk.green("✓") : chalk.red("✗");
  const label  = chalk.bold(c.label.padEnd(25));
  const detail = c.ok ? chalk.dim(c.detail ?? "") : chalk.yellow(c.detail ?? "");
  console.log(`  ${icon}  ${label} ${detail}`);
  if (!c.ok && c.fix) {
    console.log(`       ${chalk.dim("Fix:")} ${chalk.cyan(c.fix)}`);
  }
}

const doctor = new Command("doctor")
  .description("🩺 Verifica que el entorno de desarrollo esté correctamente configurado")
  .action(() => {
    console.log(chalk.bold.blue("\n  G66 Doctor — Verificación de entorno\n"));

    const checks: Check[] = [
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

    console.log(chalk.bold("  Herramientas\n"));
    checks.slice(0, 4).forEach(printCheck);

    console.log(chalk.bold("\n  Credenciales\n"));
    checks.slice(4, 6).forEach(printCheck);

    console.log(chalk.bold("\n  Workspace\n"));
    checks.slice(6).forEach(printCheck);

    const failed = checks.filter(c => !c.ok);
    console.log();

    if (failed.length === 0) {
      console.log(chalk.green.bold("  ✅ Todo OK — el entorno está listo para trabajar.\n"));
    } else {
      console.log(chalk.yellow.bold(`  ⚠️  ${failed.length} problema(s) encontrado(s). Revisá los Fix arriba.\n`));
    }
  });

export default doctor;
