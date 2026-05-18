#!/usr/bin/env python3
"""
migrate_context.py — Detecta cambios en entidades JPA del diff y genera
el changeSet Liquibase correspondiente usando Claude.
"""
import argparse, json, os, re, subprocess, sys
from datetime import datetime
from pathlib import Path

try:
    import anthropic
except ImportError:
    print(json.dumps({"ok": False, "error": "anthropic no instalado. Ejecutar: pip install anthropic"}))
    sys.exit(1)

MAX_DIFF  = 14_000
ENTITY_RE = re.compile(r'@(Entity|Table|Column|ManyToOne|OneToMany|ManyToMany|OneToOne|JoinColumn|JoinTable|Enumerated|Lob)')


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--cwd",      default=os.getcwd())
    p.add_argument("--hu",       default=None)
    p.add_argument("--dry-run",  action="store_true")
    p.add_argument("--filename", default=None, help="Nombre del archivo XML de salida")
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


def get_author(cwd):
    name = git(cwd, ["config", "user.name"])
    return name or "dev"


def find_migration_dir(cwd):
    src = Path(cwd) / "src" / "main" / "resources"
    for candidate in ["db/migrations", "db/migration", "db/changelog", "liquibase", "migrations"]:
        d = src / candidate
        if d.exists():
            return str(d)
    for yml in src.rglob("*.yaml"):
        if "databaseChangeLog" in yml.read_text(encoding="utf-8", errors="replace"):
            return str(yml.parent)
    return str(src)


def get_last_migrations(migration_dir, n=2):
    yamls = sorted(Path(migration_dir).glob("*.yaml"), key=lambda p: p.stat().st_mtime, reverse=True)
    result = []
    for yml in yamls[:n]:
        result.append({"name": yml.name, "content": yml.read_text(encoding="utf-8", errors="replace")[:3000]})
    return result


def infer_next_id(migration_dir, hu):
    today = datetime.now().strftime("%Y%m%d")
    seq   = 1
    for yml in Path(migration_dir).glob("*.yaml"):
        m = re.search(rf'{today}-(\d+)', yml.read_text(encoding="utf-8", errors="replace"))
        if m:
            seq = max(seq, int(m.group(1)) + 1)
    hu_tag = f"-{hu}" if hu else ""
    return today, seq, f"{today}-{seq}{hu_tag}"


def get_entity_diff(cwd, merge_base):
    seen: set[str] = set()
    entity_files:  list[str] = []

    def add(lines):
        for f in lines.splitlines():
            f = f.strip()
            if f and "test" not in f.lower() and "src/main/" in f and f not in seen:
                seen.add(f)
                entity_files.append(f)

    add(git(cwd, ["diff", "--name-only", merge_base, "HEAD", "--", "*.java"]))
    add(git(cwd, ["diff", "--cached", "--name-only", "--", "*.java"]))
    add(git(cwd, ["diff", "--name-only", "--", "*.java"]))

    # Filter only entity files
    diffs = []
    for f in entity_files:
        full = Path(cwd) / f
        if not full.exists():
            continue
        content = full.read_text(encoding="utf-8", errors="replace")
        if ENTITY_RE.search(content):
            diff = git(cwd, ["diff", merge_base, "--", f]) or git(cwd, ["diff", "--cached", "--", f])
            if diff:
                diffs.append({"file": f, "diff": diff[:4000]})
            else:
                # New untracked entity file
                diffs.append({"file": f, "diff": f"[NUEVO ARCHIVO]\n{content[:4000]}"})

    return diffs


def call_claude(entity_diffs, last_migrations, changeset_id, author, service, hu):
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY no definida")

    diff_text = "\n\n".join(
        f"// {d['file']}\n{d['diff']}" for d in entity_diffs
    )[:MAX_DIFF]

    ref_text = "\n\n".join(
        f"// REFERENCIA: {m['name']}\n{m['content']}" for m in last_migrations
    ) if last_migrations else "// Sin migraciones previas disponibles"

    first_id = changeset_id
    prompt = f"""Eres un senior developer de Global66. Genera un archivo Liquibase changeLog en formato YAML
para los cambios de entidades JPA detectados en el diff.

Servicio: {service}  |  HU: {hu or 'N/A'}
Autor: {author}
Primer ID del changeSet: {first_id}

REGLAS OBLIGATORIAS (G81-POL-033):
1. Un changeSet por concern (no mezclar tablas distintas en un changeSet)
2. Cada changeSet DEBE tener rollback que deshaga exactamente lo que hace
3. El campo remarks es OBLIGATORIO en cada column
4. Usar tipos MySQL: VARCHAR(n), BIGINT, INT, TINYINT(1) para boolean, DATETIME, DECIMAL(p,s)
5. Para columnas NOT NULL en tablas con datos: agregar nullable: true primero, luego constraint en changeSet separado
6. El campo schemaName debe coincidir con el del proyecto (ver migraciones de referencia)
7. IDs secuenciales: {first_id}, luego incrementar el número del medio si hay más changeSets

FORMATO YAML exacto (respetar indentación y estructura):
databaseChangeLog:
  - changeSet:
      id: {first_id}
      author: {author}
      comment: "descripción del cambio"
      changes:
        - addColumn:
            tableName: nombre_tabla
            schemaName: nombre_schema
            columns:
              - column:
                  name: nombre_columna
                  type: TIPO
                  remarks: "descripción"
                  constraints:
                    nullable: true
      rollback:
        - dropColumn:
            tableName: nombre_tabla
            schemaName: nombre_schema
            columnName: nombre_columna

MIGRACIONES EXISTENTES (copiar mismo esquema, estilo y convenciones):
{ref_text}

DIFF DE ENTIDADES:
{diff_text}

Devuelve SOLO el YAML completo, sin explicaciones, sin markdown fences, empezando con "databaseChangeLog:"
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
    yaml_out = msg.content[0].text.strip()
    if yaml_out.startswith("```"):
        yaml_out = re.sub(r'^```[a-z]*\n?', '', yaml_out)
        yaml_out = re.sub(r'\n?```$', '', yaml_out)

    _log_tokens("migrate", usage)
    return yaml_out.strip(), usage


def _log_tokens(command, usage):
    try:
        from datetime import datetime as dt
        record   = {"ts": dt.now().isoformat(), "command": command, **usage}
        log_path = Path.home() / ".g66-tokens.jsonl"
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
    except Exception:
        pass


def main():
    args    = parse_args()
    cwd     = str(Path(args.cwd).resolve())
    service = Path(cwd).name.removeprefix("ms-")
    author  = get_author(cwd)
    hu      = args.hu

    merge_base    = get_merge_base(cwd)
    entity_diffs  = get_entity_diff(cwd, merge_base)

    if not entity_diffs:
        print(json.dumps({"ok": False, "error": "No hay cambios en entidades JPA (@Entity, @Table, @Column) en esta rama"}))
        sys.exit(1)

    migration_dir          = find_migration_dir(cwd)
    last_migrations        = get_last_migrations(migration_dir)
    today, seq, first_id   = infer_next_id(migration_dir, hu)

    try:
        xml, usage = call_claude(entity_diffs, last_migrations, first_id, author, service, hu)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)

    # Naming: YYYYMMDD_HU.yaml  (igual al patrón existente del proyecto)
    hu_part   = f"_{hu}" if hu else ""
    suggested = args.filename or f"{today}{hu_part}.yaml"

    print(json.dumps({
        "ok":            True,
        "service":       service,
        "hu":            hu,
        "changeset_id":  first_id,
        "migration_dir": migration_dir,
        "filename":      suggested,
        "yaml":          xml,
        "entity_files":  [d["file"] for d in entity_diffs],
        "tokens":        usage,
    }))


if __name__ == "__main__":
    main()
