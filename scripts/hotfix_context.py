#!/usr/bin/env python3
"""
hotfix_context.py — Cherry-pick de commits seleccionados a release/master/development
y crea PRs de hotfix en CodeCommit. Publica comentario en Jira.
"""
import argparse, base64, json, os, subprocess, sys
from pathlib import Path

try:
    import requests as _req
except ImportError:
    _req = None

ENV_MAP = {"prod": "release", "ci": "master", "dev": "development"}


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--cwd",     default=os.getcwd())
    p.add_argument("--hu",      default=None)
    p.add_argument("--envs",    default="prod,ci,dev")
    p.add_argument("--commits", default=None, help="SHAs separados por coma")
    p.add_argument("--region",  default="us-east-1")
    p.add_argument("--list",    action="store_true", help="Solo listar commits recientes")
    return p.parse_args()


def git(cwd, args):
    r = subprocess.run(["git", "-C", cwd] + args, capture_output=True, text=True)
    return r.stdout.strip()


def git_run(cwd, args):
    r = subprocess.run(["git", "-C", cwd] + args, capture_output=True, text=True)
    return r.returncode == 0, r.stdout.strip(), r.stderr.strip()


def get_recent_commits(cwd):
    out = git(cwd, ["log", "--no-merges", "--format=%H|%s|%an|%ar", "-30"])
    commits = []
    for line in out.splitlines():
        parts = line.split("|", 3)
        if len(parts) == 4:
            commits.append({"sha": parts[0], "message": parts[1],
                            "author": parts[2], "date": parts[3]})
    return commits


def get_repo_name(cwd):
    top = git(cwd, ["rev-parse", "--show-toplevel"])
    return Path(top).name if top else Path(cwd).name


def get_user(cwd):
    name = git(cwd, ["config", "user.name"])
    return name.split()[0].lower() if name else "dev"


def aws_create_pr(repo, source, dest, title, desc, region):
    cmd = ["aws", "codecommit", "create-pull-request",
           "--title", title,
           "--description", desc[:10000],
           "--targets", f"repositoryName={repo},sourceReference={source},destinationReference={dest}",
           "--region", region, "--output", "json"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        return None
    try:
        pr_id = json.loads(r.stdout)["pullRequest"]["pullRequestId"]
        return (f"https://{region}.console.aws.amazon.com/codesuite/codecommit/"
                f"repositories/{repo}/pull-requests/{pr_id}/details")
    except Exception:
        return None


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


def post_jira_comment(hu, repo, results):
    if not hu or not _req:
        return
    base, email, token = jira_creds()
    if not all([base, email, token]):
        return
    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    hdrs = {"Authorization": f"Basic {auth}", "Content-Type": "application/json"}

    content = [{"type": "paragraph", "content": [
        {"type": "text", "text": f"🚨 [g66 hotfix] PRs creados en ", "marks": []},
        {"type": "text", "text": repo, "marks": [{"type": "code"}]},
    ]}]
    for env, info in results.items():
        pr_url = info.get("pr_url")
        err    = info.get("error")
        label  = env.upper()
        if err:
            content.append({"type": "paragraph", "content": [
                {"type": "text", "text": f"✗ {label}: {err}"}
            ]})
        elif pr_url:
            content.append({"type": "paragraph", "content": [
                {"type": "text", "text": f"✅ {label}: ", "marks": [{"type": "strong"}]},
                {"type": "text", "text": pr_url,
                 "marks": [{"type": "link", "attrs": {"href": pr_url}}]},
            ]})
    try:
        _req.post(f"{base}/rest/api/3/issue/{hu}/comment",
                  headers=hdrs,
                  json={"body": {"type": "doc", "version": 1, "content": content}},
                  timeout=10)
    except Exception:
        pass


def process_env(cwd, repo, env, base_branch, hotfix_branch, shas, hu, region):
    git(cwd, ["fetch", "origin"])

    # Restaurar base branch limpia
    git(cwd, ["checkout", base_branch])
    git(cwd, ["reset", "--hard", f"origin/{base_branch}"])

    # Eliminar rama local si existe
    git(cwd, ["branch", "-D", hotfix_branch])

    # Crear rama hotfix
    ok, _, err = git_run(cwd, ["checkout", "-b", hotfix_branch, f"origin/{base_branch}"])
    if not ok:
        return {"error": f"No se pudo crear rama {hotfix_branch}: {err[:150]}"}

    # Cherry-pick
    for sha in shas:
        ok, _, err = git_run(cwd, ["cherry-pick", sha])
        if not ok:
            git(cwd, ["cherry-pick", "--abort"])
            return {"error": f"Cherry-pick {sha[:7]} falló: {err[:200]}"}

    # Push
    ok, _, err = git_run(cwd, ["push", "-u", "origin", hotfix_branch])
    if not ok:
        return {"error": f"Push falló: {err[:200]}"}

    # PR
    pr_title = f"[HOTFIX][{hu}] {repo} — {env.upper()}" if hu else f"[HOTFIX] {repo} — {env.upper()}"
    pr_desc  = (f"## Hotfix {hu or ''}\n\nCommits aplicados:\n" +
                "\n".join(f"- `{s[:7]}`" for s in shas))
    pr_url = aws_create_pr(repo, hotfix_branch, base_branch, pr_title, pr_desc, region)

    return {"pr_url": pr_url, "branch": hotfix_branch}


def main():
    args = parse_args()
    cwd  = str(Path(args.cwd).resolve())

    if args.list:
        print(json.dumps({"ok": True, "commits": get_recent_commits(cwd)}))
        return

    repo = get_repo_name(cwd)
    user = get_user(cwd)
    hu   = args.hu
    envs = [e.strip() for e in args.envs.split(",") if e.strip() in ENV_MAP]
    shas = [s.strip() for s in (args.commits or "").split(",") if s.strip()]

    if not shas:
        print(json.dumps({"ok": False, "error": "No se especificaron commits (--commits sha1,sha2)"}))
        sys.exit(1)

    current_branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])

    results = {}
    for env in envs:
        base_branch   = ENV_MAP[env]
        hotfix_branch = f"{user}/{env}/{hu}" if hu else f"{user}/{env}/hotfix"
        results[env]  = process_env(cwd, repo, env, base_branch, hotfix_branch, shas, hu, args.region)

    git(cwd, ["checkout", current_branch])

    post_jira_comment(hu, repo, results)

    print(json.dumps({"ok": True, "repo": repo, "hu": hu, "results": results}))


if __name__ == "__main__":
    main()
