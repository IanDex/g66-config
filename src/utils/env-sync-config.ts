import fs from "fs";
import path from "path";
import os from "os";

export interface EnvSyncSection {
  whitelist: string[];
  /** Si es true, sync-envs falla si no hay token+canal (ver resolveSlackChatCredentials). */
  slackNotify?: boolean;
  /** xoxb-... Preferí G66_SLACK_BOT_TOKEN en el entorno. */
  slackBotToken?: string;
  /** ID de canal (ej. C0AF0AUNZT8). Preferí G66_SLACK_CHANNEL_ID. */
  slackChannelId?: string;
}

interface RawEnvSync {
  whitelist?: unknown;
  slackNotify?: unknown;
  slackBotToken?: unknown;
  slackChannelId?: unknown;
}

export interface SlackChatCredentials {
  botToken: string;
  channelId: string;
}

/**
 * Rutas relativas al repo que **siempre** se preservan al homologar con `release`
 * (backup antes de `reset --hard` y restauración después), en todos los ambientes.
 * Se unen con las entradas de `envSync.whitelist` en `.g66-config.json`.
 */
export const ENV_SYNC_BUILTIN_WHITELIST: readonly string[] = [
  "pom.xml",
  "src/main/docker/Dockerfile",
  "src/main/resources/logback.xml",
  "src/main/java/com/global/company/CompanyApplication.java"
];

function normalizeWhitelistEntry(entry: string): string {
  return entry.replace(/\\/g, "/").replace(/^[/\\]+/, "").trim();
}

/** Whitelist efectiva: built-in primero, luego la del usuario (sin duplicados). */
export function getEffectiveEnvSyncWhitelist(userEntries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of ENV_SYNC_BUILTIN_WHITELIST) {
    const n = normalizeWhitelistEntry(p);
    if (n.length > 0 && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  for (const p of userEntries) {
    const n = normalizeWhitelistEntry(p);
    if (n.length > 0 && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseEnvSyncFromRoot(data: unknown): EnvSyncSection | null {
  if (!isRecord(data)) return null;
  const envSync = data.envSync;
  if (!isRecord(envSync)) return null;
  const raw = envSync as RawEnvSync;
  const whitelistRaw = raw.whitelist;
  const whitelist: string[] = Array.isArray(whitelistRaw)
    ? whitelistRaw.filter((x): x is string => typeof x === "string")
    : [];
  const slackNotify =
    typeof raw.slackNotify === "boolean" ? raw.slackNotify : undefined;
  const slackBotToken =
    typeof raw.slackBotToken === "string" && raw.slackBotToken.trim() !== ""
      ? raw.slackBotToken.trim()
      : undefined;
  const slackChannelId =
    typeof raw.slackChannelId === "string" && raw.slackChannelId.trim() !== ""
      ? raw.slackChannelId.trim()
      : undefined;
  return {
    whitelist,
    slackNotify,
    slackBotToken,
    slackChannelId,
  };
}

/**
 * Token y canal: primero variables de entorno, luego JSON (evitá commitear el token).
 */
export function resolveSlackChatCredentials(
  envSync: EnvSyncSection,
): SlackChatCredentials | null {
  const token =
    process.env.G66_SLACK_BOT_TOKEN?.trim() ||
    envSync.slackBotToken?.trim() ||
    "";
  const channel =
    process.env.G66_SLACK_CHANNEL_ID?.trim() ||
    envSync.slackChannelId?.trim() ||
    "";

  if (envSync.slackNotify === true) {
    if (!token || !channel) {
      throw new Error(
        "envSync.slackNotify es true: definí G66_SLACK_BOT_TOKEN y G66_SLACK_CHANNEL_ID (recomendado) o envSync.slackBotToken y slackChannelId en .g66-config.json.",
      );
    }
    return { botToken: token, channelId: channel };
  }

  if (!token && !channel) return null;
  if (!token || !channel) {
    throw new Error(
      "Slack incompleto: necesitás token y canal (G66_SLACK_BOT_TOKEN + G66_SLACK_CHANNEL_ID o envSync.slackBotToken + slackChannelId).",
    );
  }
  return { botToken: token, channelId: channel };
}

function configCandidatePaths(cwd: string): string[] {
  const home = os.homedir();
  return [
    path.join(cwd, ".g66-config.json"),
    path.join(home, ".g66-config.json"),
    path.join(home, ".g66config.json"),
  ];
}

export interface LoadEnvSyncConfigMeta {
  config: EnvSyncSection;
  /**
   * Directorio del `.g66-config.json` / `.g66config.json` que aportó `envSync`.
   * Si ningún archivo tiene `envSync`, el primer archivo de config existente en el orden de búsqueda, o `cwd`.
   */
  configFileDir: string;
}

/**
 * Igual que `loadEnvSyncConfig` pero indica dónde está el JSON (para temporales `.g66_tmp`).
 */
export function loadEnvSyncConfigWithMeta(cwd: string): LoadEnvSyncConfigMeta {
  const candidates = configCandidatePaths(cwd);

  let fallbackDir = cwd;
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      fallbackDir = path.dirname(p);
      break;
    }
  }

  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, "utf-8");
      const data = JSON.parse(raw) as unknown;
      const parsed = parseEnvSyncFromRoot(data);
      if (parsed) {
        return { config: parsed, configFileDir: path.dirname(p) };
      }
    } catch {
      continue;
    }
  }

  return { config: { whitelist: [] }, configFileDir: fallbackDir };
}

/**
 * Lee `.g66-config.json` en cwd o en home; si no hay envSync, whitelist vacío.
 */
export function loadEnvSyncConfig(cwd: string): EnvSyncSection {
  return loadEnvSyncConfigWithMeta(cwd).config;
}
