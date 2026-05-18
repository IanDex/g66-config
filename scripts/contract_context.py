#!/usr/bin/env python3
"""
contract_context.py — Genera contratos de endpoints Spring Boot modificados
y los publica como comentario en la HU de Jira.

Excluye headers Claim-* (inyectados por API Gateway, no son del frontend).
"""
import argparse, base64, json, os, re, subprocess, sys
from pathlib import Path

try:
    import anthropic
except ImportError:
    print(json.dumps({"ok": False, "error": "anthropic no instalado. Ejecutar: pip install anthropic"}))
    sys.exit(1)

try:
    import requests as _requests
except ImportError:
    _requests = None

CLAIM_RE    = re.compile(r'claim[-_\s]', re.IGNORECASE)
MAPPING_RE  = re.compile(r'@(Get|Post|Put|Patch|Delete|Request)Mapping')
MAX_CODE    = 24_000

# ── helpers ──────────────────────────────────────────────────────────────────

def git(cwd: str, args: list) -> str:
    r = subprocess.run(["git", "-C", cwd] + args, capture_output=True, text=True)
    return r.stdout.strip()


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--cwd",     default=os.getcwd())
    p.add_argument("--hu",      default=None)
    p.add_argument("--region",  default="us-east-1")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--class",   dest="target_class", default=None,
                   help="Clase específica a documentar: com.pkg.ClassName o ClassName#method")
    return p.parse_args()


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


def find_class_file(cwd: str, target: str) -> list[tuple[str, str]]:
    """
    Busca un archivo Java por nombre de clase (simple o FQN) y opcionalmente
    extrae solo el método indicado con #method.
    Formato: com.pkg.ClassName  |  ClassName  |  ClassName#method  |  FQN#method
    """
    class_part, _, method_part = target.partition("#")
    # Tomar solo el nombre simple (última parte del FQN)
    simple_name = class_part.split(".")[-1].strip()
    method_name = method_part.strip() or None

    src_root = Path(cwd) / "src" / "main" / "java"
    if not src_root.exists():
        src_root = Path(cwd)

    matches = list(src_root.rglob(f"{simple_name}.java"))
    if not matches:
        return []

    results = []
    for filepath in matches:
        content = filepath.read_text(encoding="utf-8", errors="replace")

        if method_name:
            # Extraer solo el método solicitado (heurística: desde la firma hasta la siguiente al mismo nivel)
            snippet = _extract_method(content, method_name)
            if snippet:
                results.append((str(filepath.relative_to(Path(cwd))), snippet))
        else:
            results.append((str(filepath.relative_to(Path(cwd))), content))

    return results


def _extract_method(java_source: str, method_name: str) -> str:
    """Extrae un método de código Java por nombre (incluye anotaciones previas)."""
    lines = java_source.splitlines()
    start = None

    # Buscar la línea que contiene la firma del método
    for i, line in enumerate(lines):
        stripped = line.strip()
        if re.search(r'\b' + re.escape(method_name) + r'\s*\(', stripped):
            # Retroceder para incluir anotaciones (@GetMapping, etc.)
            back = i
            while back > 0 and lines[back - 1].strip().startswith("@"):
                back -= 1
            start = back
            break

    if start is None:
        return ""

    # Avanzar hasta encontrar el cierre del método (conteo de llaves)
    depth = 0
    end   = start
    in_body = False
    for i in range(start, len(lines)):
        depth += lines[i].count("{") - lines[i].count("}")
        if depth > 0:
            in_body = True
        if in_body and depth <= 0:
            end = i
            break

    return "\n".join(lines[start:end + 1])


def get_my_controller_files(cwd: str, merge_base: str) -> list[tuple[str, str]]:
    """Solo archivos tocados por el autor actual del repositorio."""
    user_email = git(cwd, ["config", "user.email"])
    user_name  = git(cwd, ["config", "user.name"])

    seen: set[str] = set()

    def add(lines: str):
        for f in lines.splitlines():
            f = f.strip()
            if f and "test" not in f.lower() and "src/main/" in f and f not in seen:
                seen.add(f)

    # Commits del autor en el branch (excluye merges)
    for author in filter(None, [user_email, user_name]):
        add(git(cwd, ["log", "--no-merges", f"--author={author}",
                      "--name-only", "--pretty=format:", f"{merge_base}..HEAD",
                      "--", "*.java"]))

    # Staged y working-tree del mismo usuario (no hay autoría aquí, se incluyen siempre)
    add(git(cwd, ["diff", "--cached", "--name-only", "--", "*.java"]))
    add(git(cwd, ["diff",             "--name-only", "--", "*.java"]))

    controllers = []
    for f in seen:
        full = Path(cwd) / f
        if not full.exists():
            continue
        content = full.read_text(encoding="utf-8", errors="replace")
        if "@RestController" in content or "@RequestMapping" in content:
            if MAPPING_RE.search(content):
                controllers.append((f, content))
    return controllers


def call_claude(controller_blocks: list[tuple[str, str]], service: str, hu: str) -> tuple[list[dict], dict]:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY no definida")

    code_section = "\n\n".join(
        f"// FILE: {fname}\n{content[:6000]}"
        for fname, content in controller_blocks
    )
    if len(code_section) > MAX_CODE:
        code_section = code_section[:MAX_CODE] + "\n[... truncado ...]"

    prompt = f"""Eres un senior developer de Global66 que documenta contratos de API REST.

Servicio: {service}  |  HU: {hu}

Analiza estos controladores Spring Boot y genera un contrato por cada endpoint nuevo o modificado.

REGLAS IMPORTANTES:
- Excluir COMPLETAMENTE cualquier header que empiece con "Claim-" (son inyectados por API Gateway, no los envía el frontend).
- Incluir solo headers que el frontend/cliente debe enviar: Content-Type, Authorization, X-* custom si aplica.
- Para request/response bodies: inferir los campos desde los DTOs del código. Si no hay DTO, indicar el tipo básico.
- El curl debe ser realista con placeholders entre < > para valores variables.
- Describir cada campo del body con su tipo y si es requerido u opcional.

Código:
{code_section}

Devuelve SOLO JSON válido con este formato:
{{
  "endpoints": [
    {{
      "method": "POST",
      "path": "/b2b/clients",
      "description": "descripción breve del propósito del endpoint",
      "headers": [
        {{"name": "Content-Type", "value": "application/json"}},
        {{"name": "Authorization", "value": "Bearer <token>"}}
      ],
      "request_body": {{
        "fields": [
          {{"name": "companyId", "type": "string (UUID)", "required": true, "description": "ID de la empresa"}},
          {{"name": "name",      "type": "string",        "required": true, "description": "Nombre del cliente"}}
        ]
      }},
      "response_body": {{
        "fields": [
          {{"name": "id",     "type": "string (UUID)", "description": "ID generado"}},
          {{"name": "status", "type": "string (enum)", "description": "ACTIVE | INACTIVE"}}
        ]
      }},
      "curl": "curl -X POST 'https://<host>/b2b/clients' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Authorization: Bearer <token>' \\\n  -d '{{\\\"companyId\\\": \\\"<uuid>\\\", \\\"name\\\": \\\"<name>\\\"}}'"
    }}
  ]
}}

Si un endpoint no tiene request body (GET, DELETE) omite el campo request_body.
Si un endpoint no tiene response body (204) omite el campo response_body.
"""

    client = anthropic.Anthropic(api_key=api_key)
    msg    = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    usage = {
        "input_tokens":  msg.usage.input_tokens,
        "output_tokens": msg.usage.output_tokens,
        "total_tokens":  msg.usage.input_tokens + msg.usage.output_tokens,
    }
    _log_tokens("contract", usage)
    raw = msg.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    data = json.loads(raw.strip())
    return data.get("endpoints", []), usage


# ── Jira ─────────────────────────────────────────────────────────────────────

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


def _text(t: str, bold=False, code=False) -> dict:
    node: dict = {"type": "text", "text": t}
    marks = []
    if bold:
        marks.append({"type": "strong"})
    if code:
        marks.append({"type": "code"})
    if marks:
        node["marks"] = marks
    return node


def _bullet_list(items: list[list[dict]]) -> dict:
    return {
        "type": "bulletList",
        "content": [
            {"type": "listItem", "content": [{"type": "paragraph", "content": nodes}]}
            for nodes in items
        ],
    }


def _code_block(text: str, lang: str = "") -> dict:
    node: dict = {"type": "codeBlock", "content": [{"type": "text", "text": text}]}
    if lang:
        node["attrs"] = {"language": lang}
    return node


def _build_adf(service: str, hu: str, endpoints: list[dict]) -> dict:
    content = [
        {
            "type": "paragraph",
            "content": [
                _text("📋 Contratos de API — "),
                _text(service, code=True),
                _text(f"  |  HU: {hu}"),
            ],
        }
    ]

    for ep in endpoints:
        method   = ep.get("method", "").upper()
        path     = ep.get("path", "")
        desc     = ep.get("description", "")
        headers  = ep.get("headers", [])
        req_body = ep.get("request_body", {})
        res_body = ep.get("response_body", {})
        curl     = ep.get("curl", "")

        # Título del endpoint
        content.append({
            "type": "heading",
            "attrs": {"level": 3},
            "content": [_text(f"{method}  {path}")],
        })

        if desc:
            content.append({"type": "paragraph", "content": [_text(desc)]})

        # Headers
        if headers:
            content.append({"type": "paragraph", "content": [_text("Headers:", bold=True)]})
            content.append(_bullet_list([
                [_text(h["name"], code=True), _text(f": {h['value']}")]
                for h in headers
            ]))

        # Request body
        req_fields = req_body.get("fields", [])
        if req_fields:
            content.append({"type": "paragraph", "content": [_text("Request body:", bold=True)]})
            content.append(_bullet_list([
                [
                    _text(f["name"], code=True),
                    _text(f" ({f.get('type','')}) — "),
                    _text("requerido" if f.get("required") else "opcional"),
                    _text(f". {f.get('description','')}" if f.get("description") else ""),
                ]
                for f in req_fields
            ]))

        # Response body
        res_fields = res_body.get("fields", [])
        if res_fields:
            content.append({"type": "paragraph", "content": [_text("Response body:", bold=True)]})
            content.append(_bullet_list([
                [
                    _text(f["name"], code=True),
                    _text(f" ({f.get('type','')})"),
                    _text(f" — {f.get('description','')}" if f.get("description") else ""),
                ]
                for f in res_fields
            ]))

        # Curl
        if curl:
            content.append({"type": "paragraph", "content": [_text("Ejemplo:", bold=True)]})
            content.append(_code_block(curl, "bash"))

    return {"type": "doc", "version": 1, "content": content}


def _log_tokens(command: str, usage: dict):
    try:
        from datetime import datetime
        record   = {"ts": datetime.now().isoformat(), "command": command, **usage}
        log_path = Path.home() / ".g66-tokens.jsonl"
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
    except Exception:
        pass


def post_jira_comment(hu: str, service: str, endpoints: list[dict]):
    if not hu or not _requests:
        return False
    base, email, token = _jira_creds()
    if not all([base, email, token]):
        sys.stderr.write("⚠️  Credenciales Jira no encontradas\n")
        return False

    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    hdrs = {"Authorization": f"Basic {auth}", "Content-Type": "application/json"}
    body = _build_adf(service, hu, endpoints)

    resp = _requests.post(
        f"{base}/rest/api/3/issue/{hu}/comment",
        headers=hdrs,
        json={"body": body},
        timeout=15,
    )
    if resp.status_code in (200, 201):
        return True
    sys.stderr.write(f"⚠️  Jira comment error {resp.status_code}: {resp.text[:300]}\n")
    return False


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    args         = parse_args()
    cwd          = str(Path(args.cwd).resolve())
    service      = get_service_name(cwd)
    branch_info  = get_branch_info(cwd)
    hu           = args.hu or branch_info["hu"]

    if args.target_class:
        controllers = find_class_file(cwd, args.target_class)
        if not controllers:
            simple = args.target_class.split(".")[-1].split("#")[0]
            print(json.dumps({"ok": False, "error": f"No se encontró {simple}.java en src/main/java"}))
            sys.exit(1)
    else:
        merge_base  = get_merge_base(cwd)
        controllers = get_my_controller_files(cwd, merge_base)
        if not controllers:
            print(json.dumps({"ok": False, "error": "No hay controladores Spring Boot con tus cambios en esta rama"}))
            sys.exit(1)

    try:
        endpoints, usage = call_claude(controllers, service, hu or "N/A")
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)

    if not endpoints:
        print(json.dumps({"ok": False, "error": "Claude no detectó endpoints nuevos o modificados"}))
        sys.exit(1)

    posted = False
    if not args.dry_run:
        posted = post_jira_comment(hu, service, endpoints)

    print(json.dumps({
        "ok":          True,
        "service":     service,
        "hu":          hu,
        "endpoints":   endpoints,
        "jira_posted": posted,
        "tokens":      usage,
    }))


if __name__ == "__main__":
    main()
