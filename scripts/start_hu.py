#!/usr/bin/env python3
"""
start_hu.py — Construye el prompt de contexto de una HU para lanzar Claude.
Lee HU de Jira + rules de ai-context del workspace.
"""
import argparse, base64, json, os, re, sys, urllib.request, urllib.error
from pathlib import Path

SETTINGS      = Path.home() / ".claude" / "settings.json"
WORKSPACE_DIR = Path.home() / "Documents" / "ms-g66"
AI_CONTEXT    = WORKSPACE_DIR / "ai-context"

REPO_KEYWORDS = {
    "fe-b2c":          ["flutter", "mobile", "b2c", "dart"],
    "fe-b2b":          ["vue", "b2b"],
    "fe-admin":        ["admin", "backoffice"],
    "product-gateway": ["spring", "java", "kotlin", "gateway", "backend", "microservice"],
}

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("hu",          help="Código HU (ej: AT-108)")
    p.add_argument("--repo-id",   help="ID del repo en ai-context (opcional, se infiere)")
    p.add_argument("--cwd",       default=os.getcwd())
    return p.parse_args()

def load_creds():
    data = json.loads(SETTINGS.read_text(encoding="utf-8"))
    env  = data["mcpServers"]["atlassian"]["env"]
    return (
        env["ATLASSIAN_BASE_URL"].rstrip("/"),
        env["ATLASSIAN_EMAIL"],
        env["ATLASSIAN_API_TOKEN"],
    )

def jira_get(base_url, auth, path):
    req = urllib.request.Request(
        f"{base_url}{path}",
        headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def adf_to_text(node) -> str:
    if not node or not isinstance(node, dict):
        return ""
    t = node.get("type", "")
    content = node.get("content", [])
    if t == "text":        return node.get("text", "")
    if t == "hardBreak":   return "\n"
    if t in ("paragraph", "heading", "listItem"):
        return "".join(adf_to_text(c) for c in content) + "\n"
    if t == "bulletList":
        return "".join("• " + adf_to_text(c) for c in content)
    if t == "codeBlock":
        return "```\n" + "".join(adf_to_text(c) for c in content) + "\n```\n"
    return "".join(adf_to_text(c) for c in content)

def infer_repo_id(cwd: str) -> str:
    repo_name = Path(cwd).name.lower()
    for repo_id, keywords in REPO_KEYWORDS.items():
        if any(k in repo_name for k in keywords):
            return repo_id
    return "product-gateway"

def load_context(repo_id: str) -> str:
    parts = []
    context_file = AI_CONTEXT / "repositories" / repo_id / "CONTEXT.md"
    if context_file.exists():
        parts.append(context_file.read_text(encoding="utf-8", errors="replace")[:2000])

    rules_dir = AI_CONTEXT / "repositories" / repo_id / "rules"
    if rules_dir.exists():
        for f in sorted(rules_dir.glob("*.md"))[:4]:
            parts.append(f"### {f.name}\n" + f.read_text(encoding="utf-8", errors="replace")[:1500])

    shared_rules = AI_CONTEXT / "shared" / "rules"
    if shared_rules.exists():
        for f in sorted(shared_rules.glob("*.md"))[:3]:
            parts.append(f"### {f.name}\n" + f.read_text(encoding="utf-8", errors="replace")[:1000])

    return "\n\n".join(parts)

def build_prompt(hu_data: dict, context: str, repo_id: str) -> str:
    hu_key   = hu_data["key"]
    title    = hu_data.get("title", "")
    status   = hu_data.get("status", "")
    assignee = hu_data.get("assignee", "")
    desc     = hu_data.get("description", "")
    url      = hu_data.get("url", "")

    lines = [
        f"# Implementar HU {hu_key}: {title}",
        "",
        f"**Jira:** {url}",
        f"**Estado:** {status}  |  **Asignado:** {assignee}",
        "",
    ]

    if desc:
        lines += ["## Descripción de la HU", "", desc.strip(), ""]

    if context:
        lines += ["## Contexto del repositorio y reglas", "", context, ""]

    lines += [
        "## Instrucciones",
        "",
        f"Implementa la HU {hu_key} siguiendo las reglas y contexto del repositorio.",
        "Antes de escribir código, revisa los archivos existentes relevantes.",
        "Aplica los lineamientos G66: arquitectura limpia, logs estructurados, sin mocks en tests.",
        "Al terminar, dime si necesito hacer push o PR.",
        "",
    ]

    return "\n".join(lines)

def main():
    args = parse_args()
    hu   = args.hu.upper()

    try:
        base_url, email, token = load_creds()
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Credenciales no encontradas: {e}"}))
        sys.exit(1)

    auth = base64.b64encode(f"{email}:{token}".encode()).decode()

    try:
        issue  = jira_get(base_url, auth, f"/rest/api/3/issue/{hu}?expand=names")
        fields = issue.get("fields", {})
        desc   = adf_to_text(fields.get("description")).strip() if isinstance(fields.get("description"), dict) else ""
        hu_data = {
            "key":      issue["key"],
            "title":    fields.get("summary", ""),
            "status":   fields.get("status", {}).get("name", ""),
            "assignee": (fields.get("assignee") or {}).get("displayName", "Sin asignar"),
            "description": desc,
            "url":      f"{base_url}/browse/{hu}",
        }
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Error leyendo HU: {e}"}))
        sys.exit(1)

    repo_id = args.repo_id or infer_repo_id(args.cwd)
    context = load_context(repo_id)
    prompt  = build_prompt(hu_data, context, repo_id)

    print(json.dumps({"ok": True, "prompt": prompt, "hu": hu_data["key"], "title": hu_data["title"]}))

if __name__ == "__main__":
    main()
