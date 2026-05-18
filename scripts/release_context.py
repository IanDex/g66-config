#!/usr/bin/env python3
"""
release_context.py — Genera changelog y crea PR master→release en CodeCommit.
Agrupa commits por HU, actualiza Jira.
"""
import argparse, base64, json, os, re, subprocess, sys, urllib.request, urllib.error
from datetime import datetime
from pathlib import Path

SETTINGS = Path.home() / ".claude" / "settings.json"


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--cwd",      default=os.getcwd())
    p.add_argument("--region",   default="us-east-1")
    p.add_argument("--dry-run",  action="store_true")
    p.add_argument("--version",  help="Nueva versión (ej: 1.5.0); si no se pasa, se infiere del pom.xml")
    return p.parse_args()


def git(repo: str, args: list) -> str:
    r = subprocess.run(["git", "-C", repo] + args, capture_output=True, text=True)
    return r.stdout.strip()


def get_repo_name(cwd: str) -> str:
    try:
        return subprocess.run(
            ["git", "-C", cwd, "rev-parse", "--show-toplevel"],
            capture_output=True, text=True
        ).stdout.strip().split("/")[-1].split("\\")[-1]
    except Exception:
        return Path(cwd).name


def get_current_branch(cwd: str) -> str:
    return git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])


def get_commits_for_release(cwd: str) -> list[dict]:
    """Commits en master que no están en release."""
    log = git(cwd, [
        "log", "origin/release..HEAD",
        "--pretty=format:%H|%s|%an|%ad",
        "--date=short",
    ])
    if not log:
        # fallback: últimos 20 commits
        log = git(cwd, [
            "log", "-20",
            "--pretty=format:%H|%s|%an|%ad",
            "--date=short",
        ])
    commits = []
    for line in log.splitlines():
        if not line.strip():
            continue
        parts = line.split("|", 3)
        if len(parts) < 4:
            continue
        sha, subject, author, date = parts
        # Extraer HU del subject: [AT-108], AT-108, GROW-661, etc.
        hu_match = re.search(r'\b([A-Z]{2,6}-\d+)\b', subject)
        commits.append({
            "sha":     sha[:8],
            "subject": subject,
            "author":  author,
            "date":    date,
            "hu":      hu_match.group(1) if hu_match else None,
        })
    return commits


def group_by_hu(commits: list[dict]) -> dict:
    grouped = {}
    for c in commits:
        key = c["hu"] or "_other"
        grouped.setdefault(key, []).append(c)
    return grouped


def build_changelog(grouped: dict, version: str, date_str: str) -> str:
    lines = [f"# Changelog v{version} — {date_str}", ""]
    for hu, commits in sorted(grouped.items()):
        if hu == "_other":
            continue
        lines.append(f"## [{hu}]")
        for c in commits:
            lines.append(f"- {c['subject'].strip()} ({c['author']}, {c['date']})")
        lines.append("")
    if "_other" in grouped:
        lines.append("## Otros cambios")
        for c in grouped["_other"]:
            lines.append(f"- {c['subject'].strip()} ({c['author']}, {c['date']})")
        lines.append("")
    return "\n".join(lines)


def read_pom_version(cwd: str) -> str | None:
    pom = Path(cwd) / "pom.xml"
    if not pom.exists():
        return None
    content = pom.read_text(encoding="utf-8")
    m = re.search(r'<version>([^<]+)</version>', content)
    return m.group(1) if m else None


def bump_patch(version: str) -> str:
    parts = version.replace("-SNAPSHOT", "").split(".")
    try:
        parts[-1] = str(int(parts[-1]) + 1)
    except ValueError:
        pass
    return ".".join(parts)


def update_pom_version(cwd: str, new_version: str) -> bool:
    pom = Path(cwd) / "pom.xml"
    if not pom.exists():
        return False
    content = pom.read_text(encoding="utf-8")
    # Reemplaza solo la primera ocurrencia de <version> (la del proyecto, no las deps)
    updated = re.sub(r'(<version>)[^<]+(</version>)', rf'\g<1>{new_version}\g<2>', content, count=1)
    pom.write_text(updated, encoding="utf-8")
    return True


def load_jira_creds():
    data = json.loads(SETTINGS.read_text(encoding="utf-8"))
    env  = data["mcpServers"]["atlassian"]["env"]
    return (
        env["ATLASSIAN_BASE_URL"].rstrip("/"),
        env["ATLASSIAN_EMAIL"],
        env["ATLASSIAN_API_TOKEN"],
    )


def jira_comment(base_url: str, auth: str, hu: str, message: str):
    body = json.dumps({
        "body": {
            "type": "doc", "version": 1,
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": message}]}]
        }
    }).encode()
    req = urllib.request.Request(
        f"{base_url}/rest/api/3/issue/{hu}/comment",
        data=body,
        headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req):
            pass
        return True
    except Exception:
        return False


def aws_create_pr(repo: str, source: str, dest: str, title: str, desc: str, region: str) -> dict | None:
    cmd = [
        "aws", "codecommit", "create-pull-request",
        "--title", title,
        "--description", desc[:10000],
        "--targets", f"repositoryName={repo},sourceReference={source},destinationReference={dest}",
        "--region", region,
        "--output", "json",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        return None
    try:
        return json.loads(r.stdout)["pullRequest"]
    except Exception:
        return None


def aws_pr_url(region: str, repo: str, pr_id: str) -> str:
    return (
        f"https://{region}.console.aws.amazon.com/codesuite/codecommit/"
        f"repositories/{repo}/pull-requests/{pr_id}/details"
    )


def main():
    args     = parse_args()
    cwd      = str(Path(args.cwd).resolve())
    branch   = get_current_branch(cwd)
    repo     = get_repo_name(cwd)
    date_str = datetime.now().strftime("%Y-%m-%d")

    # Validar rama
    if branch not in ("master", "main") and not branch.startswith("ci/"):
        print(json.dumps({"ok": False, "error": f"Ejecutar desde 'master'. Rama actual: '{branch}'"}))
        sys.exit(1)

    # Commits para release
    commits = get_commits_for_release(cwd)
    if not commits:
        print(json.dumps({"ok": False, "error": "No hay commits nuevos respecto a origin/release."}))
        sys.exit(1)

    grouped = group_by_hu(commits)

    # Versión
    current_version = read_pom_version(cwd) or "0.0.0"
    new_version     = args.version or bump_patch(current_version)
    changelog       = build_changelog(grouped, new_version, date_str)
    hu_list         = [k for k in grouped if k != "_other"]

    if args.dry_run:
        print(json.dumps({
            "ok":              True,
            "dry_run":         True,
            "repo":            repo,
            "branch":          branch,
            "current_version": current_version,
            "new_version":     new_version,
            "commit_count":    len(commits),
            "hu_list":         hu_list,
            "changelog":       changelog,
        }))
        return

    # Bump version en pom.xml
    version_updated = update_pom_version(cwd, new_version)
    if version_updated:
        git(cwd, ["add", "pom.xml"])
        git(cwd, ["commit", "-m", f"[release]: bump version to {new_version}"])

    # Push
    git(cwd, ["push", "origin", branch])

    # Crear PR en CodeCommit
    pr_title = f"[release] v{new_version} — {date_str}"
    pr_desc  = f"## Release v{new_version}\n\n{changelog}\n\n**HUs incluidas:** {', '.join(hu_list)}"
    pr_data  = aws_create_pr(repo, branch, "release", pr_title, pr_desc, args.region)

    pr_id  = pr_data["pullRequestId"] if pr_data else None
    pr_url = aws_pr_url(args.region, repo, pr_id) if pr_id else None

    # Actualizar Jira
    jira_updated = []
    if pr_url and hu_list:
        try:
            base_url, email, token = load_jira_creds()
            auth = base64.b64encode(f"{email}:{token}".encode()).decode()
            for hu in hu_list:
                msg = f"🚀 Release PR creado: v{new_version} — {pr_url}"
                if jira_comment(base_url, auth, hu, msg):
                    jira_updated.append(hu)
        except Exception:
            pass

    print(json.dumps({
        "ok":              True,
        "repo":            repo,
        "new_version":     new_version,
        "current_version": current_version,
        "commit_count":    len(commits),
        "hu_list":         hu_list,
        "changelog":       changelog,
        "pr_id":           pr_id,
        "pr_url":          pr_url,
        "jira_updated":    jira_updated,
        "version_bumped":  version_updated,
    }))


if __name__ == "__main__":
    main()
