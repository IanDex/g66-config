#!/usr/bin/env python3
"""
summary_context.py — Genera un resumen consolidado de la HU (commits, cambios,
properties, endpoints, PRs) y lo publica como comentario en Jira.
"""
import argparse, base64, json, os, re, subprocess, sys
from pathlib import Path

try:
    import anthropic
except ImportError:
    print(json.dumps({"ok": False, "error": "anthropic no instalado. Ejecutar: pip install anthropic"}))
    sys.exit(1)

try:
    import requests as _req
except ImportError:
    _req = None

MAX_DIFF = 12_000


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--cwd",     default=os.getcwd())
    p.add_argument("--hu",      default=None)
    p.add_argument("--region",  default="us-east-1")
    p.add_argument("--dry-run", action="store_true")
    return p.parse_args()


def git(cwd, args):
    r = subprocess.run(["git", "-C", cwd] + args, capture_output=True, text=True)
    return r.stdout.strip()


def get_merge_base(cwd):
    for base in ("origin/development", "origin/master", "HEAD~3"):
        mb = git(cwd, ["merge-base", "HEAD", base])
        if mb:
            return mb
    return "HEAD~1"


def get_commits(cwd, merge_base):
    out = git(cwd, ["log", "--no-merges", "--format=%h|%s|%an|%ar", f"{merge_base}..HEAD"])
    commits = []
    for line in out.splitlines():
        parts = line.split("|", 3)
        if len(parts) == 4:
            commits.append({"sha": parts[0], "message": parts[1],
                            "author": parts[2], "date": parts[3]})
    return commits


def get_changed_files(cwd, merge_base):
    out = git(cwd, ["diff", "--name-only", merge_base, "HEAD"])
    files = [f.strip() for f in out.splitlines() if f.strip()]

    categories = {"controllers": [], "services": [], "entities": [],
                  "configs": [], "tests": [], "other": []}
    for f in files:
        fl = f.lower()
        if "controller" in fl:
            categories["controllers"].append(f)
        elif "service" in fl:
            categories["services"].append(f)
        elif "entity" in fl or "model" in fl:
            categories["entities"].append(f)
        elif "config" in fl or "application" in fl or ".yml" in fl:
            categories["configs"].append(f)
        elif "test" in fl:
            categories["tests"].append(f)
        else:
            categories["other"].append(f)
    return categories, files


def get_diff_summary(cwd, merge_base):
    stat = git(cwd, ["diff", "--stat", merge_base, "HEAD"])
    return stat[:2000] if stat else ""


def jira_creds():
    path = Path.home() / ".claude" / "settings.json"
    if not path.exists():
        return None, None, None
    try:
        cfg = json.loads(path.read_text())
        e = cfg.get("mcpServers", {}).get("atlassian", {}).get("env", {})
        return e.get("ATLASSIAN_BASE_URL"), e.get("ATLASSIAN_EMAIL"), e.get("ATLASSIAN_API_TOKEN")
    except Exception:
        return None, None, None


def get_jira_issue(hu):
    base, email, token = jira_creds()
    if not all([base, email, token]) or not _req:
        return None
    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    hdrs = {"Authorization": f"Basic {auth}", "Content-Type": "application/json"}
    try:
        r = _req.get(f"{base}/rest/api/3/issue/{hu}?expand=names", headers=hdrs, timeout=10)
        if r.status_code == 200:
            data = r.json()
            return {
                "summary": data["fields"].get("summary", ""),
                "status":  data["fields"].get("status", {}).get("name", ""),
                "assignee": (data["fields"].get("assignee") or {}).get("displayName", ""),
            }
    except Exception:
        pass
    return None


def get_jira_g66_comments(hu):
    """Lee comentarios previos de g66 tools para incluirlos en el resumen."""
    base, email, token = jira_creds()
    if not all([base, email, token]) or not _req:
        return []
    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    hdrs = {"Authorization": f"Basic {auth}", "Content-Type": "application/json"}
    try:
        r = _req.get(f"{base}/rest/api/3/issue/{hu}/comment", headers=hdrs, timeout=10)
        if r.status_code != 200:
            return []
        comments = r.json().get("comments", [])
        g66_comments = []
        for c in comments:
            texts = []
            body = c.get("body", {})
            for block in (body.get("content") or []):
                for node in block.get("content", []):
                    if node.get("type") == "text":
                        texts.append(node.get("text", ""))
            text = " ".join(texts)
            if any(tag in text for tag in ["[g66 props]", "[g66 contract]", "[g66 hotfix]", "📋 Contratos", "🔧 [g66"]):
                g66_comments.append(text[:500])
        return g66_comments
    except Exception:
        return []


def call_claude(service, hu, jira_info, commits, categories, diff_stat, g66_comments):
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY no definida")

    jira_txt = ""
    if jira_info:
        jira_txt = f"Título en Jira: {jira_info['summary']}\nEstado: {jira_info['status']}\nAsignado: {jira_info['assignee']}"

    commits_txt = "\n".join(f"- {c['sha']} {c['message']} ({c['author']}, {c['date']})" for c in commits[:20])

    files_txt = ""
    for cat, files in categories.items():
        if files:
            files_txt += f"{cat}: {', '.join(Path(f).name for f in files[:5])}"
            if len(files) > 5:
                files_txt += f" (+{len(files)-5} más)"
            files_txt += "\n"

    g66_txt = "\n".join(g66_comments) if g66_comments else "(sin comentarios previos de g66)"

    prompt = f"""Eres un senior developer de Global66. Genera un resumen ejecutivo claro y conciso de los cambios
realizados en la HU {hu or 'N/A'} del servicio {service}.

El resumen será publicado como comentario en Jira para que el equipo y stakeholders entiendan
qué se implementó sin tener que leer el código.

DATOS DISPONIBLES:

{jira_txt}

Commits realizados:
{commits_txt}

Archivos modificados por categoría:
{files_txt}

Estadísticas del diff:
{diff_stat[:1000]}

Comentarios previos de herramientas g66 (properties, contratos, etc.):
{g66_txt}

INSTRUCCIONES:
- Escribe en español
- Sé específico: menciona qué clases/tablas/endpoints cambiaron
- Máximo 3-4 párrafos cortos
- Incluye: qué se implementó, impacto técnico, si hay cambios de DB/API/properties
- NO uses frases genéricas como "se realizaron cambios"
- NO repitas información que ya está en los comentarios g66 existentes
- Tono profesional y directo

Devuelve SOLO el texto del resumen (sin JSON, sin markdown headers, solo párrafos de texto plano).
"""

    client = anthropic.Anthropic(api_key=api_key)
    msg    = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    usage = {
        "input_tokens":  msg.usage.input_tokens,
        "output_tokens": msg.usage.output_tokens,
        "total_tokens":  msg.usage.input_tokens + msg.usage.output_tokens,
    }
    _log_tokens("summary", usage)
    return msg.content[0].text.strip(), usage


def post_jira_comment(hu, service, summary_text, commits, categories):
    base, email, token = jira_creds()
    if not all([base, email, token]) or not _req:
        return False
    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    hdrs = {"Authorization": f"Basic {auth}", "Content-Type": "application/json"}

    total_files = sum(len(v) for v in categories.values())
    content = [
        {"type": "paragraph", "content": [
            {"type": "text", "text": f"📝 [g66 summary] "},
            {"type": "text", "text": service, "marks": [{"type": "code"}]},
            {"type": "text", "text": f" — {len(commits)} commit(s), {total_files} archivo(s) modificado(s)"},
        ]},
        {"type": "paragraph", "content": [{"type": "text", "text": summary_text}]},
    ]

    try:
        r = _req.post(f"{base}/rest/api/3/issue/{hu}/comment",
                      headers=hdrs,
                      json={"body": {"type": "doc", "version": 1, "content": content}},
                      timeout=10)
        return r.status_code in (200, 201)
    except Exception:
        return False


def _log_tokens(command, usage):
    try:
        from datetime import datetime
        record   = {"ts": datetime.now().isoformat(), "command": command, **usage}
        log_path = Path.home() / ".g66-tokens.jsonl"
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
    except Exception:
        pass


def main():
    args    = parse_args()
    cwd     = str(Path(args.cwd).resolve())
    service = Path(cwd).name.removeprefix("ms-")
    hu      = args.hu

    merge_base  = get_merge_base(cwd)
    commits     = get_commits(cwd, merge_base)

    if not commits:
        print(json.dumps({"ok": False, "error": "No hay commits en esta rama respecto a development/master"}))
        sys.exit(1)

    categories, _ = get_changed_files(cwd, merge_base)
    diff_stat     = get_diff_summary(cwd, merge_base)
    jira_info     = get_jira_issue(hu) if hu else None
    g66_comments  = get_jira_g66_comments(hu) if hu else []

    try:
        summary_text, usage = call_claude(service, hu, jira_info, commits,
                                          categories, diff_stat, g66_comments)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)

    posted = False
    if not args.dry_run and hu:
        posted = post_jira_comment(hu, service, summary_text, commits, categories)

    print(json.dumps({
        "ok":      True,
        "service": service,
        "hu":      hu,
        "summary": summary_text,
        "commits": len(commits),
        "files":   sum(len(v) for v in categories.values()),
        "posted":  posted,
        "tokens":  usage,
    }))


if __name__ == "__main__":
    main()
