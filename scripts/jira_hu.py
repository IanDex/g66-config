#!/usr/bin/env python3
"""
jira_hu.py — Lee detalles de una HU de Jira via REST API v3.
Credenciales desde ~/.claude/settings.json (mcpServers.atlassian.env)
"""
import argparse, base64, json, os, sys, urllib.request, urllib.error
from pathlib import Path

SETTINGS = Path.home() / ".claude" / "settings.json"

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("hu", help="Código de la HU (ej: AT-108)")
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
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {body[:300]}")

def adf_to_text(node, depth=0) -> str:
    if not node or not isinstance(node, dict):
        return ""
    t = node.get("type", "")
    content = node.get("content", [])
    text = node.get("text", "")

    if t == "text":
        return text
    if t == "hardBreak":
        return "\n"
    if t in ("paragraph", "heading"):
        inner = "".join(adf_to_text(c) for c in content)
        return inner + "\n"
    if t == "bulletList":
        return "".join("• " + adf_to_text(c) for c in content)
    if t == "listItem":
        return "".join(adf_to_text(c) for c in content)
    if t == "codeBlock":
        inner = "".join(adf_to_text(c) for c in content)
        return f"```\n{inner}\n```\n"
    return "".join(adf_to_text(c) for c in content)

def extract_pr_links(fields: dict) -> list[str]:
    links = []
    for key, val in fields.items():
        if not isinstance(val, dict):
            continue
        content = val.get("content", [])
        if not content:
            continue
        for block in content:
            for node in block.get("content", []):
                t = node.get("text", "")
                if "console.aws.amazon.com" in t or "codecommit" in t:
                    links.append(t)
    return links

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
        issue = jira_get(base_url, auth, f"/rest/api/3/issue/{hu}?expand=names,renderedFields")
    except RuntimeError as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)

    fields  = issue.get("fields", {})
    names   = issue.get("names", {})

    # Descripción
    desc_adf = fields.get("description")
    description = adf_to_text(desc_adf).strip() if isinstance(desc_adf, dict) else (desc_adf or "")

    # PRs — buscar en todos los customfields que tengan "PR en"
    pr_links: list[str] = []
    for key, name in names.items():
        if "PR en" in name:
            val = fields.get(key)
            if isinstance(val, dict):
                for block in val.get("content", []):
                    for node in block.get("content", []):
                        t = node.get("text", "")
                        if t.strip():
                            pr_links.append({"env": name, "url": t.strip()})

    # Subtareas
    subtasks = [
        {"key": s["key"], "summary": s["fields"].get("summary", ""), "status": s["fields"].get("status", {}).get("name", "")}
        for s in fields.get("subtasks", [])
    ]

    # Links a otras HUs
    issue_links = []
    for lnk in fields.get("issuelinks", []):
        other = lnk.get("inwardIssue") or lnk.get("outwardIssue")
        if other:
            issue_links.append({
                "type": lnk.get("type", {}).get("name", ""),
                "key": other["key"],
                "summary": other["fields"].get("summary", ""),
                "status": other["fields"].get("status", {}).get("name", ""),
            })

    print(json.dumps({
        "ok": True,
        "key": issue["key"],
        "title": fields.get("summary", ""),
        "status": fields.get("status", {}).get("name", ""),
        "assignee": (fields.get("assignee") or {}).get("displayName", "Sin asignar"),
        "priority": (fields.get("priority") or {}).get("name", ""),
        "story_points": fields.get("story_points") or fields.get("customfield_10016"),
        "description": description[:1500] if description else "",
        "pr_links": pr_links,
        "subtasks": subtasks,
        "issue_links": issue_links,
        "url": f"{base_url}/browse/{hu}",
    }, ensure_ascii=False))

if __name__ == "__main__":
    main()
