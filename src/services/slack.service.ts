export interface EnvSyncSlackPayload {
  sourceBranch: string;
  targets: Array<{
    branch: string;
    commits: Array<{ hash: string; author: string; subject: string }>;
  }>;
}

const SLACK_CHAT_POST_URL = "https://slack.com/api/chat.postMessage";

const MAX_AUTHORS_LISTED = 40;

/** Agrupa commits por autor (nombre de Git); orden por cantidad descendente. */
function formatCommitsGroupedByAuthor(
  commits: EnvSyncSlackPayload["targets"][0]["commits"],
): string {
  if (commits.length === 0) return "  (ninguno)";

  const byAuthor = new Map<string, number>();
  for (const c of commits) {
    const name = c.author.trim() || "(sin autor)";
    byAuthor.set(name, (byAuthor.get(name) ?? 0) + 1);
  }

  const sorted = [...byAuthor.entries()].sort((a, b) => b[1] - a[1]);
  const lines: string[] = [];
  const shown = sorted.slice(0, MAX_AUTHORS_LISTED);
  for (const [author, count] of shown) {
    const word = count === 1 ? "cambio" : "cambios";
    lines.push(`  • ${author} — ${count} ${word} no en release`);
  }
  const omitted = sorted.length - shown.length;
  if (omitted > 0) {
    lines.push(`  … y ${omitted} autor${omitted === 1 ? "" : "es"} más (recortado por límite de mensaje)`);
  }
  return lines.join("\n");
}

function buildMessageText(payload: EnvSyncSlackPayload): string {
  const lines: string[] = [
    "🚨 Environment sync executed",
    `Source: ${payload.sourceBranch}`,
    "",
  ];
  for (const t of payload.targets) {
    lines.push(`Branch: ${t.branch}`);
    lines.push("Resumen por desarrollador (commits en destino que no están en release):");
    lines.push(formatCommitsGroupedByAuthor(t.commits));
    lines.push("");
  }
  return lines.join("\n").trim();
}

interface SlackApiOk {
  ok: true;
}

interface SlackApiErr {
  ok: false;
  error?: string;
}

type SlackApiResponse = SlackApiOk | SlackApiErr;

/**
 * Envía mensaje con la API de Slack (Bot token + chat.postMessage).
 */
export async function postEnvSyncSlackChatMessage(
  botToken: string,
  channelId: string,
  payload: EnvSyncSlackPayload,
): Promise<void> {
  const text = buildMessageText(payload);

  const res = await fetch(SLACK_CHAT_POST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: channelId,
      text,
    }),
  });

  const raw = await res.text();
  let data: SlackApiResponse;
  try {
    data = JSON.parse(raw) as SlackApiResponse;
  } catch {
    throw new Error(
      `Slack API: respuesta no JSON (${res.status}): ${raw.slice(0, 200)}`,
    );
  }

  if (!data.ok) {
    const err = "error" in data ? data.error : undefined;
    throw new Error(
      `Slack chat.postMessage falló: ${err ?? "unknown"} (HTTP ${res.status})`,
    );
  }
}
