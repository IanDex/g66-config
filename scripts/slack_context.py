#!/usr/bin/env python3
"""
slack_context.py — Interacción con Slack Lists (tableros) para g66.
Lee token y canal desde ~/.g66-config.json (sección "slack").
"""
import argparse, json, sys
from pathlib import Path

try:
    import requests
except ImportError:
    print(json.dumps({"ok": False, "error": "requests no instalado. Ejecutar: pip install requests"}))
    sys.exit(1)


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--action",   default="test",
                   choices=["test", "discover", "add", "users"],
                   help="test=verificar token | discover=listar tableros | add=agregar item | users=listar miembros del canal")
    p.add_argument("--hu",       default=None)
    p.add_argument("--pr-url",   default=None)
    p.add_argument("--title",    default=None)
    p.add_argument("--list-id",     default=None, help="ID del tablero/list de Slack")
    p.add_argument("--assignee-id", default=None, help="Slack user ID del asignado")
    p.add_argument("--comments",    default=None, help="Comentario opcional del dev")
    p.add_argument("--env",         default=None, help="Ambiente: dev | ci | prod")
    p.add_argument("--dev-name",    default=None, help="Nombre del desarrollador")
    return p.parse_args()


def load_config():
    path = Path.home() / ".g66-config.json"
    if not path.exists():
        return None, None, None, None
    try:
        data = json.loads(path.read_text())
        slack = data.get("slack", {})
        return (slack.get("token"), slack.get("channel"),
                slack.get("webhook_url"), slack.get("dev_channel"),
                slack.get("excluded_users", []), slack.get("my_user_id"))
    except Exception:
        return None, None, None, None, [], None


def list_channel_members(token, channel, excluded=None):
    """Lista miembros del canal con nombre + Slack user ID."""
    members_resp = slack_get(token, "conversations.members", {"channel": channel, "limit": 200})
    if not members_resp.get("ok"):
        return {"ok": False, "error": members_resp.get("error")}

    member_ids = members_resp.get("members", [])
    excluded_set = set(excluded or [])
    users = []
    for uid in member_ids:
        if uid in excluded_set:
            continue
        info = slack_get(token, "users.info", {"user": uid})
        if not info.get("ok"):
            continue
        u = info.get("user", {})
        if u.get("is_bot") or u.get("deleted"):
            continue
        profile = u.get("profile", {})
        users.append({
            "id":           u["id"],
            "name":         profile.get("real_name") or u.get("real_name") or u.get("name"),
            "display_name": profile.get("display_name") or u.get("name"),
        })

    users.sort(key=lambda x: x["name"])
    return {"ok": True, "members": users, "channel": channel}


def slack_get(token, method, params=None):
    r = requests.get(
        f"https://slack.com/api/{method}",
        headers={"Authorization": f"Bearer {token}"},
        params=params or {},
        timeout=10,
    )
    return r.json()


def slack_post(token, method, payload):
    r = requests.post(
        f"https://slack.com/api/{method}",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=payload,
        timeout=10,
    )
    return r.json()


def test_token(token, channel):
    # Verificar token
    auth = slack_get(token, "auth.test")
    if not auth.get("ok"):
        return {"ok": False, "error": f"Token inválido: {auth.get('error')}"}

    # Info del canal
    info = slack_get(token, "conversations.info", {"channel": channel})
    channel_name = info.get("channel", {}).get("name", channel) if info.get("ok") else channel

    return {
        "ok":      True,
        "user":    auth.get("user"),
        "team":    auth.get("team"),
        "channel": channel_name,
        "channel_id": channel,
    }


def discover_lists(token, channel):
    """Intenta descubrir tableros/lists en el canal."""
    results = {}

    # Intentar API de lists (puede requerir scopes adicionales)
    lists_resp = slack_get(token, "lists.list", {"channel": channel})
    results["lists_api"] = lists_resp

    # Listar canvases del canal
    canvas_resp = slack_get(token, "canvases.sections.lookup", {"canvas_id": channel})
    results["canvas_api"] = canvas_resp

    # Mensajes recientes (para ver si hay algún tablero referenciado)
    history = slack_get(token, "conversations.history", {"channel": channel, "limit": 5})
    results["has_history"] = history.get("ok", False)
    results["available_scopes"] = []

    return {"ok": True, "discovery": results}


ENV_URL_FIELD = {"dev": "pr_url_dev", "ci": "pr_url_ci", "prod": "pr_url_prod"}


def add_via_webhook(webhook_url, hu, pr_url, title, assignee_id=None, comments=None, env=None, dev_name=None):
    """Agrega item al tablero via Workflow Builder webhook."""
    item_title = title or (f"[{hu}] PR" if hu else "PR")
    payload = {}
    if hu:          payload["hu"]          = hu
    if title:       payload["title"]       = item_title
    if assignee_id: payload["assignee_id"] = assignee_id
    if comments:    payload["comments"]    = comments
    if dev_name:    payload["dev"]         = dev_name
    if pr_url and env and env in ENV_URL_FIELD:
        payload[ENV_URL_FIELD[env]] = pr_url
    elif pr_url:
        payload["pr_url_dev"] = pr_url  # fallback
    r = requests.post(webhook_url, json=payload, timeout=10)
    if r.status_code in (200, 204):
        return {"ok": True, "method": "workflow_webhook"}
    return {"ok": False, "error": f"HTTP {r.status_code}: {r.text[:200]}"}


def add_item(token, channel, list_id, hu, pr_url, title, webhook_url=None, assignee_id=None, comments=None, env=None, dev_name=None):
    """Agrega un item al tablero de Slack."""
    item_title = title or (f"[{hu}] {pr_url}" if hu else pr_url or "PR")

    if not webhook_url:
        return {"ok": False, "error": "webhook_url no configurado en ~/.g66-config.json (slack.webhook_url)"}

    return add_via_webhook(webhook_url, hu, pr_url, item_title,
                           assignee_id=assignee_id, comments=comments,
                           env=env, dev_name=dev_name)


def main():
    args                                                  = parse_args()
    token, channel, webhook, dev_ch, excluded, my_user_id = load_config()

    if not token or not channel:
        print(json.dumps({"ok": False, "error": "Token o canal no encontrado en ~/.g66-config.json (sección 'slack')"}))
        sys.exit(1)

    if args.action == "test":
        print(json.dumps(test_token(token, channel)))

    elif args.action == "discover":
        print(json.dumps(discover_lists(token, channel)))

    elif args.action == "add":
        # dev_name: usar my_user_id del config si no se pasó explícitamente
        dev = args.dev_name or my_user_id
        if not dev:
            print(json.dumps({
                "ok": False,
                "error": "my_user_id no configurado",
                "setup": (
                    "Para configurar tu usuario de Slack:\n"
                    "1. En Slack, click en tu foto de perfil → 'Perfil'\n"
                    "2. Click en ⋮ (tres puntos) → 'Copiar ID de miembro'\n"
                    "3. Agregar a ~/.g66-config.json:\n"
                    '   "slack": { ..., "my_user_id": "UXXXXXXXXX" }'
                )
            }))
            sys.exit(1)
        result = add_item(token, channel, args.list_id,
                          args.hu, args.pr_url, args.title,
                          webhook_url=webhook, assignee_id=args.assignee_id,
                          comments=args.comments, env=args.env,
                          dev_name=dev)
        print(json.dumps(result))

    elif args.action == "users":
        target = dev_ch or channel
        print(json.dumps(list_channel_members(token, target, excluded=excluded)))


if __name__ == "__main__":
    main()
