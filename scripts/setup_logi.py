#!/usr/bin/env python3
"""
setup_logi.py — Genera logi/config.py extrayendo credenciales de ms-config-properties.
Lee company.yml desde los branches development (dev) y master (ci).
"""
import argparse, json, os, re, subprocess, sys
from pathlib import Path

LOGI_DIR    = Path(__file__).parent.parent / "logi"
CONFIG_OUT  = LOGI_DIR / "config.py"
DEFAULT_CONFIG_PROPS = Path.home() / "Documents" / "ms-g66" / "ms-config-properties"
SERVICE_FILE = "company.yml"

BRANCH_MAP = {
    "dev": "development",
    "ci":  "master",
}

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--repo",    default=str(DEFAULT_CONFIG_PROPS),
                   help="Ruta local a ms-config-properties")
    p.add_argument("--service", default="company",
                   help="Nombre del servicio (default: company)")
    p.add_argument("--dry-run", action="store_true")
    return p.parse_args()

def git_show(repo: Path, branch: str, file: str) -> str:
    r = subprocess.run(
        ["git", "show", f"{branch}:{file}"],
        capture_output=True, text=True, cwd=str(repo)
    )
    if r.returncode != 0:
        raise RuntimeError(f"git show {branch}:{file} falló: {r.stderr.strip()}")
    return r.stdout

def extract_value(yaml_text: str, *keys: str) -> str | None:
    """Busca key: value en YAML plano (sin librería para no requerir pyyaml)."""
    for key in keys:
        pattern = rf"^\s*{re.escape(key)}\s*:\s*(.+)$"
        m = re.search(pattern, yaml_text, re.MULTILINE)
        if m:
            val = m.group(1).strip().strip('"').strip("'")
            if val and not val.startswith("{cipher}"):
                return val
    return None

def parse_jdbc_host(url: str) -> str:
    m = re.search(r"jdbc:mysql://([^:/]+)", url)
    return m.group(1) if m else url

def extract_env_config(yaml_text: str) -> dict:
    url      = extract_value(yaml_text, "url")
    host     = parse_jdbc_host(url) if url else "unknown"
    user     = extract_value(yaml_text, "username")
    password = extract_value(yaml_text, "password")
    pool_id  = extract_value(yaml_text, "user-pool-id")
    # Preferir el client "new" si existe
    client_id = extract_value(yaml_text, "user-pool-client-id-new") \
             or extract_value(yaml_text, "user-pool-client-id")
    secret   = extract_value(yaml_text, "user-pool-client-secret")

    return {
        "company_db": {
            "host":     host,
            "port":     3306,
            "db":       "company",
            "user":     user or "ms-company",
            "password": password or "",
        },
        "cognito": {
            "region":        "us-east-1",
            "user_pool_id":  pool_id or "",
            "client_id":     client_id or "",
            "client_secret": secret or "",
        },
    }

def render_config(configs: dict) -> str:
    lines = ["CONFIGS = {"]
    for env, cfg in configs.items():
        db  = cfg["company_db"]
        cog = cfg["cognito"]
        lines.append(f'    "{env}": {{')
        lines.append( '        "company_db": {')
        lines.append(f'            "host": "{db["host"]}",')
        lines.append(f'            "port": {db["port"]},')
        lines.append(f'            "db": "{db["db"]}",')
        lines.append(f'            "user": "{db["user"]}",')
        lines.append(f'            "password": "{db["password"]}",')
        lines.append( '        },')
        lines.append( '        "cognito": {')
        lines.append(f'            "region": "{cog["region"]}",')
        lines.append(f'            "user_pool_id": "{cog["user_pool_id"]}",')
        lines.append(f'            "client_id": "{cog["client_id"]}",')
        lines.append(f'            "client_secret": "{cog["client_secret"]}",')
        lines.append( '        },')
        lines.append( '    },')
    lines.append("}")
    lines.append("")
    lines.append('DEFAULT_PASSWORD = "Global66"')
    lines.append("")
    return "\n".join(lines)

def main():
    args = parse_args()
    repo = Path(args.repo)
    svc  = f"{args.service}.yml"

    if not repo.exists():
        print(json.dumps({"ok": False,
            "error": f"No se encontró el repo en {repo}. Usa --repo <ruta>."}))
        sys.exit(1)

    configs = {}
    for env, branch in BRANCH_MAP.items():
        try:
            yaml_text = git_show(repo, branch, svc)
            configs[env] = extract_env_config(yaml_text)
        except Exception as e:
            print(json.dumps({"ok": False, "error": str(e)}))
            sys.exit(1)

    content = render_config(configs)

    if args.dry_run:
        print(json.dumps({"ok": True, "preview": content}))
        return

    CONFIG_OUT.write_text(content, encoding="utf-8")
    print(json.dumps({"ok": True, "path": str(CONFIG_OUT)}))

if __name__ == "__main__":
    main()
