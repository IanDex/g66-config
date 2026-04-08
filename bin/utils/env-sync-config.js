"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENV_SYNC_BUILTIN_WHITELIST = void 0;
exports.getEffectiveEnvSyncWhitelist = getEffectiveEnvSyncWhitelist;
exports.resolveSlackChatCredentials = resolveSlackChatCredentials;
exports.loadEnvSyncConfigWithMeta = loadEnvSyncConfigWithMeta;
exports.loadEnvSyncConfig = loadEnvSyncConfig;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
/**
 * Rutas relativas al repo que **siempre** se preservan al homologar con `release`
 * (backup antes de `reset --hard` y restauración después), en todos los ambientes.
 * Se unen con las entradas de `envSync.whitelist` en `.g66-config.json`.
 */
exports.ENV_SYNC_BUILTIN_WHITELIST = [
    "pom.xml",
    "src/main/docker/Dockerfile",
    "src/main/resources/logback.xml",
    "src/main/java/com/global/company/CompanyApplication.java"
];
function normalizeWhitelistEntry(entry) {
    return entry.replace(/\\/g, "/").replace(/^[/\\]+/, "").trim();
}
/** Whitelist efectiva: built-in primero, luego la del usuario (sin duplicados). */
function getEffectiveEnvSyncWhitelist(userEntries) {
    const seen = new Set();
    const out = [];
    for (const p of exports.ENV_SYNC_BUILTIN_WHITELIST) {
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
function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function parseEnvSyncFromRoot(data) {
    if (!isRecord(data))
        return null;
    const envSync = data.envSync;
    if (!isRecord(envSync))
        return null;
    const raw = envSync;
    const whitelistRaw = raw.whitelist;
    const whitelist = Array.isArray(whitelistRaw)
        ? whitelistRaw.filter((x) => typeof x === "string")
        : [];
    const slackNotify = typeof raw.slackNotify === "boolean" ? raw.slackNotify : undefined;
    const slackBotToken = typeof raw.slackBotToken === "string" && raw.slackBotToken.trim() !== ""
        ? raw.slackBotToken.trim()
        : undefined;
    const slackChannelId = typeof raw.slackChannelId === "string" && raw.slackChannelId.trim() !== ""
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
function resolveSlackChatCredentials(envSync) {
    const token = process.env.G66_SLACK_BOT_TOKEN?.trim() ||
        envSync.slackBotToken?.trim() ||
        "";
    const channel = process.env.G66_SLACK_CHANNEL_ID?.trim() ||
        envSync.slackChannelId?.trim() ||
        "";
    if (envSync.slackNotify === true) {
        if (!token || !channel) {
            throw new Error("envSync.slackNotify es true: definí G66_SLACK_BOT_TOKEN y G66_SLACK_CHANNEL_ID (recomendado) o envSync.slackBotToken y slackChannelId en .g66-config.json.");
        }
        return { botToken: token, channelId: channel };
    }
    if (!token && !channel)
        return null;
    if (!token || !channel) {
        throw new Error("Slack incompleto: necesitás token y canal (G66_SLACK_BOT_TOKEN + G66_SLACK_CHANNEL_ID o envSync.slackBotToken + slackChannelId).");
    }
    return { botToken: token, channelId: channel };
}
function configCandidatePaths(cwd) {
    const home = os_1.default.homedir();
    return [
        path_1.default.join(cwd, ".g66-config.json"),
        path_1.default.join(home, ".g66-config.json"),
        path_1.default.join(home, ".g66config.json"),
    ];
}
/**
 * Igual que `loadEnvSyncConfig` pero indica dónde está el JSON (para temporales `.g66_tmp`).
 */
function loadEnvSyncConfigWithMeta(cwd) {
    const candidates = configCandidatePaths(cwd);
    let fallbackDir = cwd;
    for (const p of candidates) {
        if (fs_1.default.existsSync(p)) {
            fallbackDir = path_1.default.dirname(p);
            break;
        }
    }
    for (const p of candidates) {
        if (!fs_1.default.existsSync(p))
            continue;
        try {
            const raw = fs_1.default.readFileSync(p, "utf-8");
            const data = JSON.parse(raw);
            const parsed = parseEnvSyncFromRoot(data);
            if (parsed) {
                return { config: parsed, configFileDir: path_1.default.dirname(p) };
            }
        }
        catch {
            continue;
        }
    }
    return { config: { whitelist: [] }, configFileDir: fallbackDir };
}
/**
 * Lee `.g66-config.json` en cwd o en home; si no hay envSync, whitelist vacío.
 */
function loadEnvSyncConfig(cwd) {
    return loadEnvSyncConfigWithMeta(cwd).config;
}
