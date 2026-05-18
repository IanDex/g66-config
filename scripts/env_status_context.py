#!/usr/bin/env python3
"""
env_status_context.py — Muestra qué HUs están en cada rama (release/master/development)
detectando los códigos [HU] en los mensajes de commit.
"""
import argparse, json, os, re, subprocess
from pathlib import Path

HU_RE     = re.compile(r'\b([A-Z]{2,6}-\d+)\b')
BRANCHES  = ["release", "master", "development"]
BRANCH_LABELS = {"release": "PROD", "master": "CI", "development": "DEV"}

DEFAULT_IGNORE = ["Dockerfile", "docker-compose*.yml", "application-*.yml"]


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--cwd", default=os.getcwd())
    return p.parse_args()


def git(cwd, args):
    r = subprocess.run(["git", "-C", cwd] + args, capture_output=True, text=True)
    return r.stdout.strip()


def get_hus_in_branch(cwd, branch) -> dict[str, list[str]]:
    """Retorna {HU: [sha, sha, ...]} para la rama dada."""
    out = git(cwd, ["log", f"origin/{branch}", "--no-merges",
                    "--format=%H %s", "--max-count=200"])
    hus: dict[str, list[str]] = {}
    for line in out.splitlines():
        parts = line.split(" ", 1)
        if len(parts) < 2:
            continue
        sha, msg = parts
        for hu in HU_RE.findall(msg):
            hus.setdefault(hu, []).append(sha)
    return hus


def get_ignore_patterns(cwd) -> list[str]:
    cfg_path = Path.home() / ".g66-config.json"
    if cfg_path.exists():
        try:
            data = json.loads(cfg_path.read_text())
            patterns = data.get("homologIgnore")
            if patterns:
                return patterns
        except Exception:
            pass
    return DEFAULT_IGNORE


def main():
    args = parse_args()
    cwd  = str(Path(args.cwd).resolve())

    git(cwd, ["fetch", "--all", "--quiet"])

    branch_hus: dict[str, dict[str, list[str]]] = {}
    for branch in BRANCHES:
        branch_hus[branch] = get_hus_in_branch(cwd, branch)

    # Unión de todas las HUs
    all_hus = sorted(
        set().union(*[set(v.keys()) for v in branch_hus.values()]),
        reverse=True,
    )

    matrix = []
    for hu in all_hus:
        row = {"hu": hu}
        for branch in BRANCHES:
            row[branch] = hu in branch_hus[branch]
        matrix.append(row)

    print(json.dumps({
        "ok":      True,
        "matrix":  matrix,
        "ignore":  get_ignore_patterns(cwd),
        "branches": BRANCHES,
    }))


if __name__ == "__main__":
    main()
