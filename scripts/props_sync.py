#!/usr/bin/env python3
"""
props_sync.py — Detecta @Value properties en archivos modificados del diff Java
y las agrega al YAML de ms-config-properties (dev/ci/prod), creando un branch
y PR en CodeCommit por cada ambiente.

Estrategia de escritura: inserción de texto puro — no reescribe el archivo,
solo añade las líneas faltantes en el lugar correcto. Preserva comillas,
indentación y formato del contenido existente.
"""
import argparse, base64, json, os, re, subprocess, sys
from pathlib import Path

try:
    import requests as _requests
except ImportError:
    _requests = None

try:
    import yaml
except ImportError:
    print(json.dumps({"ok": False, "error": "PyYAML no instalado. Ejecutar: pip install pyyaml"}))
    sys.exit(1)

CONFIG_POINTER = Path.home() / ".g66-config.json"
VALUE_RE = re.compile(r'@Value\s*\(\s*["\']?\$\{([^}:]+?)(?::([^}]*))?\}["\']?\s*\)')

ENV_MAP = {
    "dev":  "development",
    "ci":   "master",
    "prod": "release",
}

# ── helpers ──────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--cwd",      default=os.getcwd())
    p.add_argument("--envs",     default="dev,ci,prod")
    p.add_argument("--hu",       default=None, help="Código HU explícito (ej: AT-108)")
    p.add_argument("--region",   default="us-east-1")
    p.add_argument("--dry-run",  action="store_true")
    p.add_argument("--values",   default=None, help="JSON con valores explícitos {key: value}")
    return p.parse_args()

def git(repo: str, args: list) -> str:
    r = subprocess.run(["git", "-C", repo] + args, capture_output=True, text=True)
    return r.stdout.strip()

def reset_and_pull(repo: str, branch: str):
    """Checkout branch, resetea cualquier estado sucio/conflictos y hace pull."""
    git(repo, ["checkout", branch])
    git(repo, ["reset", "--hard", "HEAD"])
    git(repo, ["clean", "-fd"])
    git(repo, ["pull", "--ff-only"])

def get_config_repo() -> str | None:
    if CONFIG_POINTER.exists():
        try:
            data = json.loads(CONFIG_POINTER.read_text(encoding="utf-8"))
            p = data.get("configRepoPath", "")
            if p and Path(p).exists():
                return p
        except Exception:
            pass
    default = str(Path.home() / "Documents" / "ms-g66" / "ms-config-properties")
    return default if Path(default).exists() else None

def get_service_name(cwd: str) -> str:
    return Path(cwd).name.removeprefix("ms-")

def get_branch_info(cwd: str) -> dict:
    branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])
    parts  = branch.split("/")
    return {
        "branch": branch,
        "user":   parts[0] if len(parts) >= 3 else "dev",
        "hu":     parts[-1].upper() if len(parts) >= 3 else None,
    }

def get_merge_base(cwd: str) -> str:
    for base in ("origin/development", "origin/master", "HEAD~3"):
        mb = git(cwd, ["merge-base", "HEAD", base])
        if mb:
            return mb
    return "HEAD~1"

def get_modified_java_files(cwd: str, merge_base: str) -> list[str]:
    seen = set()
    result = []

    def add(lines: str):
        for f in lines.splitlines():
            f = f.strip()
            if f and "test" not in f.lower() and "src/main/" in f and f not in seen:
                seen.add(f)
                result.append(f)

    # 1. Committed: diff entre merge-base y HEAD
    add(git(cwd, ["diff", "--name-only", merge_base, "HEAD", "--", "*.java"]))
    # 2. Staged (git add pero sin commit)
    add(git(cwd, ["diff", "--cached", "--name-only", "--", "*.java"]))
    # 3. Unstaged (modificados en working tree, sin git add)
    add(git(cwd, ["diff", "--name-only", "--", "*.java"]))
    # 4. Untracked (archivos nuevos que aún no están en git)
    add(git(cwd, ["ls-files", "--others", "--exclude-standard", "--", "*.java"]))

    return result

def find_value_annotations(cwd: str, files: list[str]) -> dict[str, str | None]:
    props: dict[str, str | None] = {}
    for filepath in files:
        full = Path(cwd) / filepath
        if not full.exists():
            continue
        content = full.read_text(encoding="utf-8", errors="replace")
        for m in VALUE_RE.finditer(content):
            key     = m.group(1).strip()
            default = m.group(2).strip() if m.group(2) is not None else None
            if key not in props:
                props[key] = default
    return props

# ── YAML detection (parse only, never dump) ──────────────────────────────────

def load_yaml_dict(yaml_path: str) -> dict:
    text = Path(yaml_path).read_text(encoding="utf-8")
    if "<<<<<<< " in text or ">>>>>>> " in text:
        raise ValueError(f"El archivo {Path(yaml_path).name} tiene conflictos de merge sin resolver. Resolvelos antes de continuar.")
    try:
        return yaml.safe_load(text) or {}
    except yaml.YAMLError as e:
        raise ValueError(f"YAML inválido en {Path(yaml_path).name}: {e}")

def _navigate(data: dict, parts: list[str]) -> bool:
    cur = data
    for part in parts:
        if not isinstance(cur, dict) or part not in cur:
            return False
        cur = cur[part]
    return True

def key_exists(data: dict, dotted_key: str) -> bool:
    """Busca la key en el dict YAML, probando prefijos flat + resto nested."""
    parts = dotted_key.split(".")
    for split_at in range(len(parts), 0, -1):
        flat_key    = ".".join(parts[:split_at])
        nested_rest = parts[split_at:]
        if flat_key in data:
            return True if not nested_rest else _navigate(data[flat_key], nested_rest)
    return False

# ── YAML text insertion (preserva formato original) ──────────────────────────

SPECIAL_CHARS = set(':{}[]|>&*!,#?@`"\'')

def format_yaml_value(value) -> str:
    """Serializa un valor para insertar como texto YAML."""
    if value is None:
        return "~ # TODO: configurar"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    s = str(value)
    if s.startswith("# TODO"):
        return s
    # Necesita comillas si tiene chars especiales o es keyword YAML
    needs_quotes = (
        any(c in s for c in SPECIAL_CHARS) or
        s.lower() in ("true", "false", "null", "~", "yes", "no", "on", "off") or
        re.match(r'^\d', s) and not s.lstrip('-').isdigit()
    )
    return f'"{s}"' if needs_quotes else s

def build_snippet(parts: list[str], value, base_indent: int) -> list[str]:
    """
    Construye las líneas YAML para insertar (sin tocar contenido existente).
    parts  = sub-path a crear (ej: ['security', 'client-secret', 'bytes'])
    base_indent = indentación del padre (en espacios)
    """
    lines = []
    indent = base_indent + 2
    for i, part in enumerate(parts):
        if i == len(parts) - 1:
            lines.append(" " * indent + f"{part}: {format_yaml_value(value)}")
        else:
            lines.append(" " * indent + f"{part}:")
            indent += 2
    return lines

def find_section_insert_point(text_lines: list[str], parent_key: str, parent_indent: int) -> int:
    """
    Dado el parent_key ya encontrado en parent_line_idx, devuelve el índice
    donde se deben insertar las líneas nuevas (final de la sección).
    """
    parent_line_idx = next(
        (i for i, l in enumerate(text_lines)
         if l.lstrip().startswith(parent_key + ":") and
         len(l) - len(l.lstrip()) == parent_indent),
        -1
    )
    if parent_line_idx < 0:
        return len(text_lines)

    for i in range(parent_line_idx + 1, len(text_lines)):
        line = text_lines[i]
        if not line.strip():        # línea en blanco: puede ser del bloque
            continue
        cur_indent = len(line) - len(line.lstrip())
        if cur_indent <= parent_indent:  # salimos del bloque
            return i
    return len(text_lines)

def insert_property_into_text(yaml_text: str, dotted_key: str, value) -> str:
    """
    Inserta la property en el texto YAML sin reescribir nada existente.
    Estrategia:
      1. Encuentra el prefijo flat más largo que ya existe en el texto.
      2. Calcula dónde termina esa sección.
      3. Inserta solo las líneas nuevas ahí.
      4. Si no hay prefijo, agrega al final.
    """
    parts      = dotted_key.split(".")
    lines      = yaml_text.splitlines()

    # Buscar prefijo flat más largo presente en el texto
    best_split  = 0
    best_indent = 0
    best_idx    = -1

    for split_at in range(len(parts), 0, -1):
        flat_key = ".".join(parts[:split_at])
        for i, line in enumerate(lines):
            stripped = line.lstrip()
            indent   = len(line) - len(stripped)
            # Coincide si la línea es "flat_key:" con indentación cualquiera
            if re.match(r'^' + re.escape(flat_key) + r'\s*:', stripped):
                best_split  = split_at
                best_indent = indent
                best_idx    = i
                break
        if best_idx >= 0:
            break

    remaining = parts[best_split:]

    if best_idx >= 0 and remaining:
        insert_at = find_section_insert_point(lines, ".".join(parts[:best_split]), best_indent)
        snippet   = build_snippet(remaining, value, best_indent)
        new_lines = lines[:insert_at] + snippet + lines[insert_at:]
    elif best_idx >= 0 and not remaining:
        # La key entera ya existe — no hacer nada
        return yaml_text
    else:
        # Prefijo no encontrado: agregar como bloque nuevo al final
        snippet   = build_snippet(parts, value, -2)  # base_indent -2 → empieza en 0
        new_lines = lines + [""] + snippet

    return "\n".join(new_lines) + ("\n" if yaml_text.endswith("\n") else "")

# ── AWS CodeCommit ────────────────────────────────────────────────────────────

def aws_create_pr(repo: str, source: str, dest: str, title: str, desc: str, region: str) -> str | None:
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
        pr_id = json.loads(r.stdout)["pullRequest"]["pullRequestId"]
        return (f"https://{region}.console.aws.amazon.com/codesuite/codecommit/"
                f"repositories/{repo}/pull-requests/{pr_id}/details")
    except Exception:
        return None

# ── pipeline por ambiente ─────────────────────────────────────────────────────

def process_env(config_repo: str, yaml_path: str, yaml_filename: str,
                env: str, base_branch: str, pr_branch: str,
                missing: dict, service: str, hu: str | None, region: str) -> dict:

    reset_and_pull(config_repo, base_branch)
    git(config_repo, ["branch", "-D", pr_branch])
    git(config_repo, ["checkout", "-b", pr_branch])

    # Insertar properties SIN reescribir el archivo completo
    yaml_text = Path(yaml_path).read_text(encoding="utf-8")
    for key, default in missing.items():
        coerced  = _coerce(default)
        yaml_text = insert_property_into_text(yaml_text, key, coerced)
    Path(yaml_path).write_text(yaml_text, encoding="utf-8")

    commit_msg = (f"[{hu}]: add missing @Value properties for {service} ({env})"
                  if hu else f"[props]: add missing @Value properties for {service} ({env})")
    git(config_repo, ["add", yaml_filename])
    git(config_repo, ["commit", "-m", commit_msg])
    git(config_repo, ["push", "-u", "origin", pr_branch])

    pr_title = (f"[{hu}] {service} — @Value properties ({env})"
                if hu else f"{service} — @Value properties ({env})")
    pr_desc  = ("## Properties agregadas\n\n" +
                "\n".join(f"- `{k}`" for k in missing) +
                f"\n\n**Servicio:** `{service}`  |  **HU:** `{hu or 'N/A'}`")
    pr_url = aws_create_pr("ms-config-properties", pr_branch, base_branch,
                           pr_title, pr_desc, region)

    reset_and_pull(config_repo, base_branch)
    return {"added": list(missing.keys()), "pr_branch": pr_branch, "pr_url": pr_url}

def _coerce(value: str | None):
    if value is None or value == "":
        return None
    try: return int(value)
    except ValueError: pass
    try: return float(value)
    except ValueError: pass
    if value.lower() == "true":  return True
    if value.lower() == "false": return False
    return value

# ── Jira comment ─────────────────────────────────────────────────────────────

def _jira_creds():
    path = Path.home() / ".claude" / "settings.json"
    if not path.exists():
        return None, None, None
    try:
        cfg = json.loads(path.read_text(encoding="utf-8"))
        e   = cfg.get("mcpServers", {}).get("atlassian", {}).get("env", {})
        return e.get("ATLASSIAN_BASE_URL"), e.get("ATLASSIAN_EMAIL"), e.get("ATLASSIAN_API_TOKEN")
    except Exception:
        return None, None, None


def post_jira_comment(hu: str, service: str, results: dict):
    if not hu or not _requests:
        return
    base, email, token = _jira_creds()
    if not all([base, email, token]):
        return

    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    hdrs = {"Authorization": f"Basic {auth}", "Content-Type": "application/json"}

    # Construir contenido ADF
    content = [
        {
            "type": "paragraph",
            "content": [{"type": "text", "text": f"🔧 [g66 props] {hu} — properties agregadas en ", "marks": []},
                        {"type": "text", "text": service, "marks": [{"type": "code"}]}],
        }
    ]

    for env, info in results.items():
        added    = info.get("added", [])
        pr_url   = info.get("pr_url")
        env_err  = info.get("error")
        if env_err or not added:
            continue

        # Encabezado del ambiente
        env_text = env.upper()
        header_nodes = [{"type": "text", "text": env_text, "marks": [{"type": "strong"}]}]
        if pr_url:
            header_nodes.append({"type": "text", "text": " — "})
            header_nodes.append({"type": "text", "text": "ver PR", "marks": [{"type": "link", "attrs": {"href": pr_url}}]})
        content.append({"type": "paragraph", "content": header_nodes})

        # Lista de properties
        list_items = [
            {
                "type": "listItem",
                "content": [{"type": "paragraph", "content": [{"type": "text", "text": k, "marks": [{"type": "code"}]}]}],
            }
            for k in added
        ]
        content.append({"type": "bulletList", "content": list_items})

    try:
        resp = _requests.post(
            f"{base}/rest/api/3/issue/{hu}/comment",
            headers=hdrs,
            json={"body": {"type": "doc", "version": 1, "content": content}},
            timeout=10,
        )
        if resp.status_code not in (200, 201):
            sys.stderr.write(f"⚠️  Jira comment error {resp.status_code}: {resp.text[:200]}\n")
    except Exception as exc:
        sys.stderr.write(f"⚠️  Jira comment falló: {exc}\n")


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    args        = parse_args()
    cwd         = str(Path(args.cwd).resolve())
    service     = get_service_name(cwd)
    envs        = [e.strip() for e in args.envs.split(",") if e.strip() in ENV_MAP]
    branch_info = get_branch_info(cwd)
    hu          = args.hu or branch_info["hu"]
    user        = branch_info["user"]

    config_repo = get_config_repo()
    if not config_repo:
        print(json.dumps({"ok": False, "error": "ms-config-properties no encontrado. Ejecutar: g66 setup"}))
        sys.exit(1)

    yaml_filename = f"{service}.yml"
    yaml_path     = str(Path(config_repo) / yaml_filename)

    if not Path(yaml_path).exists():
        print(json.dumps({"ok": False, "error": f"No existe {yaml_filename} en ms-config-properties"}))
        sys.exit(1)

    merge_base     = get_merge_base(cwd)
    modified_files = get_modified_java_files(cwd, merge_base)

    if not modified_files:
        print(json.dumps({"ok": False, "error": "No hay archivos Java modificados en esta rama respecto a development/master"}))
        sys.exit(1)

    all_props = find_value_annotations(cwd, modified_files)

    if not all_props:
        print(json.dumps({"ok": False, "error": "Los archivos modificados no tienen @Value annotations"}))
        sys.exit(1)

    results = {}

    for env in envs:
        base_branch = ENV_MAP[env]
        pr_branch   = f"{user}/{env}/{hu}" if hu else f"{user}/{env}/props"

        # Siempre reset + pull para estar actualizados y sin estado sucio
        reset_and_pull(config_repo, base_branch)

        try:
            data = load_yaml_dict(yaml_path)
        except ValueError as e:
            results[env] = {"added": [], "pr_url": None, "error": str(e)}
            continue

        missing = {k: v for k, v in all_props.items() if not key_exists(data, k)}

        if not missing:
            results[env] = {"added": [], "pr_url": None, "message": "Todas las properties ya existen"}
            continue

        if args.dry_run:
            results[env] = {
                "added":    list(missing.keys()),
                "details":  [{"key": k, "default": v} for k, v in missing.items()],
                "dry_run":  True,
                "pr_url":   None,
            }
            continue

        # Aplicar valores explícitos provistos por el usuario (sobreescriben defaults)
        explicit_values: dict = {}
        if args.values:
            try:
                explicit_values = json.loads(args.values)
            except Exception:
                pass
        merged = {k: explicit_values.get(k, v) for k, v in missing.items()}

        results[env] = process_env(
            config_repo, yaml_path, yaml_filename,
            env, base_branch, pr_branch,
            merged, service, hu, args.region,
        )

    if not args.dry_run:
        post_jira_comment(hu, service, results)

    print(json.dumps({
        "ok":               True,
        "service":          service,
        "hu":               hu,
        "results":          results,
        "total_code_props": len(all_props),
        "scanned_files":    modified_files,
    }))

if __name__ == "__main__":
    main()
