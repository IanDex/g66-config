"""
Full PR pipeline:
  diff → Claude → git add → spotless → commit → push → CodeCommit PR → Jira

Uso:
  python pr_ai.py [--dry-run] [--region us-east-1]
"""
import argparse
import base64
import json
import os
import subprocess
import sys
from pathlib import Path

import anthropic
import boto3
from botocore.exceptions import ClientError
import requests


MAX_DIFF = 18_000

ENV_TO_BASE  = {"dev": "development", "ci": "master", "prod": "release"}
ENV_TO_JIRA  = {"dev": "PR en dev",   "ci": "PR en CI", "prod": "PR en Prod"}


# ── helpers ──────────────────────────────────────────────────────────────────

def sh(cmd, check=False):
    if isinstance(cmd, str):
        return subprocess.run(cmd, capture_output=True, text=True, shell=True)
    return subprocess.run(cmd, capture_output=True, text=True)


def git(*args):
    return sh(["git"] + list(args))


def log(msg):
    print(msg, file=sys.stderr, flush=True)


# ── branch ───────────────────────────────────────────────────────────────────

def get_branch():
    return git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip()


def parse_branch(branch):
    """user/env/HU  →  (user, env, HU)"""
    parts = branch.split("/", 2)
    if len(parts) == 3:
        return parts[0], parts[1], parts[2]
    return None, None, None


def get_repo():
    top = git("rev-parse", "--show-toplevel").stdout.strip()
    return Path(top).name if top else None


# ── diff ─────────────────────────────────────────────────────────────────────

def get_diff(base_branch):
    committed = git("diff", f"origin/{base_branch}...HEAD").stdout
    staged    = git("diff", "--staged").stdout
    unstaged  = git("diff").stdout
    return (committed + staged + unstaged)[:MAX_DIFF]


def get_commits(base_branch):
    return git("log", f"origin/{base_branch}...HEAD", "--oneline").stdout.strip()


# ── Claude ───────────────────────────────────────────────────────────────────

def analyze(diff, commits, hu, author):
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        log("ERROR: ANTHROPIC_API_KEY no definida")
        sys.exit(1)

    if not diff.strip():
        log("⚠️  Sin diff — usando defaults")
        return {"title": "Cambios varios", "description": "Cambios menores.", "needs_gateway": "No", "needs_db": "No", "db_details": None, "needs_properties": "No"}

    client = anthropic.Anthropic(api_key=api_key)
    prompt = f"""Eres senior dev de Global66. Analiza este diff Java/Spring Boot.

HU: {hu} | Autor: {author}
Commits:
{commits}

Diff:
{diff}

Devuelve SOLO JSON válido:
{{
  "title": "título descriptivo (máx 80 chars, sin el código {hu})",
  "description": "2-3 oraciones: qué cambió, por qué, impacto técnico",
  "needs_gateway": "Sí o No — Sí si hay @RestController/@XxxMapping nuevo/modificado",
  "needs_db": "Sí o No — Sí si hay @Entity/@Column nuevos o archivos Liquibase en db/migrations",
  "db_details": "descripción columnas/tablas si needs_db=Sí, sino null",
  "needs_properties": "Sí o No — Sí si hay @Value/${{...}} nuevos o keys nuevas en application.yml"
}}"""

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=900,
        messages=[{"role": "user", "content": prompt}],
    )
    # exponer uso de tokens en el resultado
    _usage = {
        "input_tokens":  msg.usage.input_tokens,
        "output_tokens": msg.usage.output_tokens,
        "total_tokens":  msg.usage.input_tokens + msg.usage.output_tokens,
    }
    analyze._last_usage = _usage
    _log_tokens("pr-smart", _usage)
    raw = msg.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


def _log_tokens(command, usage):
    try:
        from datetime import datetime
        from pathlib import Path as _P
        record   = {"ts": datetime.now().isoformat(), "command": command, **usage}
        log_path = _P.home() / ".g66-tokens.jsonl"
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
    except Exception:
        pass


def build_description(hu, author, ai):
    db = ai.get("db_details") or "No aplica"
    return f"""- **Encargado**: {author}
- **Link historia**: [Enlace Jira](https://global66.atlassian.net/browse/{hu})
- **Descripción del desarrollo**:
> {ai['description']}
- **Dependencia de uno o varios PRs**: No
- **¿Requiere creación de endpoint en API Gateway?**: {ai.get('needs_gateway', 'No')}
- **¿Requiere creación de columna/as o tabla/as?**: {ai.get('needs_db', 'No')}
- **Datos de columna/as o tabla/as**: {db}
- **¿Requiere agregar propiedades al proyecto?**: {ai.get('needs_properties', 'No')}
"""


# ── git pipeline ─────────────────────────────────────────────────────────────

def git_add():
    sh("git add .")
    for f in ["mvnw", "mvnw.cmd"]:
        git("restore", "--staged", f)


def run_spotless():
    log("🧹 spotless:apply...")
    apply = sh("mvn spotless:apply -q")
    if apply.returncode != 0:
        log(f"❌ spotless:apply falló:\n{apply.stderr[-800:]}")
        sys.exit(2)

    log("🧹 spotless:check...")
    check = sh("mvn spotless:check -q")
    if check.returncode != 0:
        log(f"❌ spotless:check falló:\n{check.stderr[-800:]}")
        sys.exit(2)
    log("✅ Spotless OK")


def do_commit(hu, title):
    msg = f"[{hu}]: {title}"
    r = sh(f'git commit -m "{msg}"')
    out = r.stdout + r.stderr
    if r.returncode != 0:
        if "nothing to commit" in out:
            log("ℹ️  Sin cambios para commitear")
            return False
        log(f"❌ Commit falló:\n{out}")
        sys.exit(1)
    log(f"✅ Commit: {msg}")
    return True


def do_push(branch):
    log(f"📤 Push {branch}...")
    r = sh(f"git push origin {branch}")
    if r.returncode != 0:
        log(f"❌ Push falló:\n{r.stderr}")
        sys.exit(1)
    log("✅ Push OK")


# ── CodeCommit ────────────────────────────────────────────────────────────────

def find_open_pr(cc, repo, branch):
    try:
        ids = cc.list_pull_requests(repositoryName=repo, pullRequestStatus="OPEN").get("pullRequestIds", [])
        for pr_id in ids:
            pr = cc.get_pull_request(pullRequestId=pr_id)["pullRequest"]
            for t in pr.get("pullRequestTargets", []):
                src = t.get("sourceReference", "")
                if src == branch or src == f"refs/heads/{branch}":
                    return pr
    except ClientError as e:
        log(f"⚠️  No se pudo listar PRs: {e}")
    return None


def create_or_update_pr(repo, branch, base_branch, title, description, region):
    cc = boto3.client("codecommit", region_name=region)
    existing = find_open_pr(cc, repo, branch)

    if existing:
        pr_id = existing["pullRequestId"]
        cc.update_pull_request_title(pullRequestId=pr_id, title=title)
        cc.update_pull_request_description(pullRequestId=pr_id, description=description)
        log(f"✅ PR #{pr_id} actualizado")
        return pr_id, False

    try:
        resp = cc.create_pull_request(
            title=title,
            description=description,
            targets=[{"repositoryName": repo, "sourceReference": branch, "destinationReference": base_branch}],
        )
        pr_id = resp["pullRequest"]["pullRequestId"]
        log(f"✅ PR #{pr_id} creado")
        return pr_id, True
    except ClientError as e:
        log(f"❌ CodeCommit: {e.response['Error']['Message']}")
        sys.exit(1)


# ── Jira ──────────────────────────────────────────────────────────────────────

def jira_creds():
    path = Path.home() / ".claude" / "settings.json"
    if not path.exists():
        return None, None, None
    cfg = json.loads(path.read_text())
    env = cfg.get("mcpServers", {}).get("atlassian", {}).get("env", {})
    return env.get("ATLASSIAN_BASE_URL"), env.get("ATLASSIAN_EMAIL"), env.get("ATLASSIAN_API_TOKEN")


def update_jira(hu, env_name, pr_url):
    base, email, token = jira_creds()
    if not all([base, email, token]):
        log("⚠️  Credenciales Jira no encontradas — Jira no actualizado")
        return False

    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    hdrs = {"Authorization": f"Basic {auth}", "Content-Type": "application/json"}

    resp = requests.get(f"{base}/rest/api/3/issue/{hu}?expand=names", headers=hdrs, timeout=10)
    if resp.status_code != 200:
        log(f"⚠️  Issue {hu} no encontrado: {resp.status_code}")
        return False

    data  = resp.json()
    label = ENV_TO_JIRA.get(env_name, "PR en dev")
    names = data.get("names", {})
    fid   = next((k for k, v in names.items() if v == label), None)

    if not fid:
        log(f"⚠️  Campo '{label}' no encontrado en Jira")
        return False

    # Read existing value to append
    existing = None
    fval = data.get("fields", {}).get(fid)
    if fval and fval.get("content"):
        for block in fval["content"]:
            for node in block.get("content", []):
                if node.get("type") == "text" and node.get("text", "").strip():
                    existing = node["text"]

    content = []
    if existing:
        content.append({"type": "paragraph", "content": [{"type": "text", "text": existing}]})
    content.append({"type": "paragraph", "content": [{"type": "text", "text": pr_url}]})

    put = requests.put(
        f"{base}/rest/api/3/issue/{hu}",
        headers=hdrs,
        json={"fields": {fid: {"type": "doc", "version": 1, "content": content}}},
        timeout=10,
    )
    if put.status_code in (200, 204):
        log(f"✅ Jira {hu} → '{label}' actualizado")
        return True
    log(f"⚠️  Jira error {put.status_code}: {put.text[:200]}")
    return False


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--region", default="us-east-1")
    args = parser.parse_args()

    branch = get_branch()
    repo   = get_repo()
    user, env, hu = parse_branch(branch)

    if not hu:
        log(f"ERROR: rama '{branch}' no sigue user/env/HU")
        sys.exit(1)

    base_branch = ENV_TO_BASE.get(env, "development")
    author = git("config", "user.name").stdout.strip() or user

    log(f"🌿 {branch}  →  {base_branch}  |  HU: {hu}  |  repo: {repo}")
    log("🤖 Analizando diff con Claude...")

    diff    = get_diff(base_branch)
    commits = get_commits(base_branch)
    ai      = analyze(diff, commits, hu, author)

    title       = f"[{hu}] {ai['title']}"
    description = build_description(hu, author, ai)

    result = {"branch": branch, "repo": repo, "hu": hu, "env": env,
              "base_branch": base_branch, "title": title,
              "description": description, "ai_fields": ai}

    if args.dry_run:
        print(json.dumps(result))
        return

    git_add()
    run_spotless()
    git_add()  # re-stagear cambios de spotless
    do_commit(hu, ai["title"])
    do_push(branch)

    pr_id, is_new = create_or_update_pr(repo, branch, base_branch, title, description, args.region)
    region = args.region
    pr_url = (f"https://{region}.console.aws.amazon.com/codesuite/codecommit"
              f"/repositories/{repo}/pull-requests/{pr_id}/details")

    if is_new:
        update_jira(hu, env, pr_url)

    result.update({"pr_id": pr_id, "pr_url": pr_url, "is_new": is_new,
                   "tokens": getattr(analyze, "_last_usage", None)})
    print(json.dumps(result))


if __name__ == "__main__":
    main()
