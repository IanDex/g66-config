#!/usr/bin/env python3
"""
sync_context.py — Cherry-pick HUs de source → target con exclusión de archivos
configurados, spotless y push directo.
"""
import argparse, fnmatch, json, os, subprocess, sys
from pathlib import Path

HU_RE    = re.compile(r'\b([A-Z]{2,6}-\d+)\b') if False else __import__('re').compile(r'\b([A-Z]{2,6}-\d+)\b')
DEFAULT_IGNORE = ["Dockerfile", "docker-compose*.yml", "application-*.yml"]


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--cwd",    default=os.getcwd())
    p.add_argument("--source", required=True, help="Rama origen (release/master/development)")
    p.add_argument("--target", required=True, help="Rama destino (release/master/development)")
    p.add_argument("--hus",    required=True, help="HUs separadas por coma (AT-110,AT-108)")
    p.add_argument("--dry-run", action="store_true")
    return p.parse_args()


def git(cwd, args):
    r = subprocess.run(["git", "-C", cwd] + args, capture_output=True, text=True)
    return r.stdout.strip()


def git_run(cwd, args):
    r = subprocess.run(["git", "-C", cwd] + args, capture_output=True, text=True)
    return r.returncode == 0, r.stdout.strip(), r.stderr.strip()


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


def get_commits_for_hus(cwd, branch, hus: list[str]) -> list[tuple[str, str]]:
    """Retorna [(sha, msg)] para los commits de las HUs dadas en el branch, orden cronológico."""
    out = git(cwd, ["log", f"origin/{branch}", "--no-merges",
                    "--format=%H %s", "--max-count=300"])
    result = []
    seen: set[str] = set()
    for line in out.splitlines():
        parts = line.split(" ", 1)
        if len(parts) < 2:
            continue
        sha, msg = parts
        for hu in hus:
            if hu.upper() in msg.upper() and sha not in seen:
                seen.add(sha)
                result.append((sha, msg))
    # Invertir para aplicar en orden cronológico
    return list(reversed(result))


def get_commits_in_branch(cwd, branch) -> set[str]:
    """SHAs de commits en el branch (para detectar duplicados)."""
    out = git(cwd, ["log", f"origin/{branch}", "--no-merges",
                    "--format=%H", "--max-count=300"])
    return set(out.splitlines())


def restore_excluded_files(cwd, target, patterns):
    """Restaura archivos excluidos al estado de origin/target."""
    changed = git(cwd, ["diff", "--name-only", "--cached"])
    changed += "\n" + git(cwd, ["diff", "--name-only"])
    restored = []
    for f in set(changed.splitlines()):
        f = f.strip()
        if not f:
            continue
        name = Path(f).name
        for pattern in patterns:
            if fnmatch.fnmatch(name, pattern) or fnmatch.fnmatch(f, pattern):
                git(cwd, ["checkout", f"origin/{target}", "--", f])
                restored.append(f)
                break
    return restored


def run_spotless(cwd) -> bool:
    r = subprocess.run(["mvn", "spotless:apply", "-q"], cwd=cwd,
                       capture_output=True, text=True)
    return r.returncode == 0


def has_uncommitted(cwd) -> bool:
    return bool(git(cwd, ["status", "--porcelain"]))


def main():
    args    = parse_args()
    cwd     = str(Path(args.cwd).resolve())
    source  = args.source
    target  = args.target
    hus     = [h.strip().upper() for h in args.hus.split(",") if h.strip()]
    ignore  = get_ignore_patterns(cwd)

    git(cwd, ["fetch", "--all", "--quiet"])

    commits = get_commits_for_hus(cwd, source, hus)
    if not commits:
        print(json.dumps({"ok": False,
                          "error": f"No se encontraron commits para {', '.join(hus)} en {source}"}))
        sys.exit(1)

    # Filtrar commits que ya están en target
    target_shas = get_commits_in_branch(cwd, target)
    commits = [(sha, msg) for sha, msg in commits if sha not in target_shas]
    if not commits:
        print(json.dumps({"ok": True, "message": "Todas las HUs ya están en el branch destino",
                          "applied": []}))
        return

    if args.dry_run:
        print(json.dumps({
            "ok":      True,
            "commits": [{"sha": sha[:7], "msg": msg} for sha, msg in commits],
            "source":  source,
            "target":  target,
            "hus":     hus,
            "ignore":  ignore,
        }))
        return

    # Guardar rama actual para restaurar si algo falla
    original_branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])

    # Checkout target
    ok, _, err = git_run(cwd, ["checkout", target])
    if not ok:
        print(json.dumps({"ok": False, "error": f"No se pudo hacer checkout de {target}: {err}"}))
        sys.exit(1)
    git(cwd, ["reset", "--hard", f"origin/{target}"])

    applied   = []
    conflicts = []

    for sha, msg in commits:
        ok, _, err = git_run(cwd, ["cherry-pick", sha])
        if not ok:
            git(cwd, ["cherry-pick", "--abort"])
            conflicts.append({"sha": sha[:7], "msg": msg, "error": err[:200]})
            continue

        # Restaurar archivos excluidos
        restored = restore_excluded_files(cwd, target, ignore)
        if restored:
            git(cwd, ["add"] + restored)
            has_staged = git(cwd, ["diff", "--cached", "--quiet"]) == ""
            if not has_staged:
                git(cwd, ["commit", "--amend", "--no-edit"])

        applied.append({"sha": sha[:7], "msg": msg, "restored": restored})

    if not applied:
        git(cwd, ["checkout", original_branch])
        print(json.dumps({"ok": False,
                          "error": "Ningún commit pudo aplicarse",
                          "conflicts": conflicts}))
        sys.exit(1)

    # Spotless
    spotless_ok = run_spotless(cwd)
    if spotless_ok and has_uncommitted(cwd):
        git(cwd, ["add", "."])
        git(cwd, ["commit", "-m", f"[SYNC] spotless after cherry-pick {', '.join(hus)}"])

    # Push
    ok, _, err = git_run(cwd, ["push", "origin", target])
    if not ok:
        print(json.dumps({"ok": False, "error": f"Push falló: {err[:300]}",
                          "applied": applied}))
        sys.exit(1)

    git(cwd, ["checkout", original_branch])

    print(json.dumps({
        "ok":       True,
        "source":   source,
        "target":   target,
        "hus":      hus,
        "applied":  applied,
        "conflicts": conflicts,
        "spotless": spotless_ok,
    }))


if __name__ == "__main__":
    main()
