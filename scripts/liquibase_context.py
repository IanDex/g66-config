#!/usr/bin/env python3
"""
liquibase_context.py — Detecta cambios en entidades JPA y construye el prompt
para que Claude genere el changeset Liquibase siguiendo G81-POL-033.
"""
import argparse, json, os, re, subprocess, sys
from datetime import datetime
from pathlib import Path

WORKSPACE_DIR = Path.home() / "Documents" / "ms-g66"
LIQUIBASE_RULE = WORKSPACE_DIR / "ai-context" / "shared" / "rules" / "groups" / "backend" / "liquibase.md"

ENTITY_ANNOTATIONS = {"@Entity", "@Table", "@Column", "@Enumerated", "@OneToMany",
                       "@ManyToOne", "@OneToOne", "@ManyToMany", "@JoinColumn", "@Embedded"}

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--cwd",    default=os.getcwd())
    p.add_argument("--hu",     help="Código HU (ej: AT-108); se infiere de la rama si no se pasa")
    return p.parse_args()

def git(repo: str, args: list) -> str:
    r = subprocess.run(["git", "-C", repo] + args, capture_output=True, text=True)
    return r.stdout

def get_branch_info(cwd: str) -> dict:
    branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).strip()
    parts  = branch.split("/")
    hu     = parts[-1].upper() if len(parts) >= 3 else None
    user   = parts[0]          if len(parts) >= 3 else "dev"
    return {"branch": branch, "hu": hu, "user": user}

def get_merge_base(cwd: str) -> str:
    for base in ("origin/development", "origin/master", "HEAD~3"):
        mb = git(cwd, ["merge-base", "HEAD", base]).strip()
        if mb:
            return mb
    return "HEAD~1"

def get_modified_java_files(cwd: str, merge_base: str) -> list:
    out = git(cwd, ["diff", "--name-only", merge_base, "HEAD", "--", "*.java"])
    return [f for f in out.splitlines() if f.strip()]

def is_entity_file(cwd: str, filepath: str) -> bool:
    full = Path(cwd) / filepath
    if not full.exists():
        return False
    content = full.read_text(encoding="utf-8", errors="replace")
    return any(ann in content for ann in {"@Entity", "@Table"})

def has_entity_changes_in_diff(diff: str) -> bool:
    for line in diff.splitlines():
        if not line.startswith("+") or line.startswith("+++"):
            continue
        if any(ann in line for ann in ENTITY_ANNOTATIONS):
            return True
    return False

def get_file_diff(cwd: str, filepath: str, merge_base: str) -> str:
    return git(cwd, ["diff", "--unified=5", merge_base, "HEAD", "--", filepath])

def find_migrations_dir(cwd: str) -> Path | None:
    for candidate in [
        Path(cwd) / "src" / "main" / "resources" / "db" / "migrations",
        Path(cwd) / "src" / "main" / "resources" / "db" / "changelog",
    ]:
        if candidate.exists():
            return candidate
    return None

def load_recent_migrations(cwd: str, n: int = 2) -> list[tuple[str, str]]:
    migrations_dir = find_migrations_dir(cwd)
    if not migrations_dir:
        return []
    files = sorted(migrations_dir.glob("*.yaml"), key=lambda f: f.name, reverse=True)
    result = []
    for f in files[:n]:
        result.append((f.name, f.read_text(encoding="utf-8", errors="replace")[:3000]))
    return result

def infer_schema(migrations: list[tuple[str, str]]) -> str:
    for _, content in migrations:
        m = re.search(r"schemaName:\s*(\S+)", content)
        if m:
            return m.group(1)
    return "<schema_name>"

def infer_author(migrations: list[tuple[str, str]], fallback: str) -> str:
    for _, content in migrations:
        m = re.search(r"author:\s*(\S+)", content)
        if m and m.group(1) not in ("crisis", "root", "admin", "generated"):
            return m.group(1)
    return fallback

def load_guidelines() -> str:
    if LIQUIBASE_RULE.exists():
        return LIQUIBASE_RULE.read_text(encoding="utf-8")
    return ""

def build_prompt(cwd: str, hu: str | None, user: str, branch: str,
                 entity_diffs: list[tuple[str, str]],
                 migrations: list[tuple[str, str]],
                 schema: str, author: str,
                 guidelines: str) -> str:
    repo_name = Path(cwd).name
    ts_now    = datetime.now().strftime("%Y%m%d")
    hu_label  = hu or "HU-XXX"

    lines = [
        f"# Generar migración Liquibase — {repo_name}",
        "",
        f"**Repo:** `{repo_name}`  |  **Rama:** `{branch}`  |  **HU:** `{hu_label}`",
        f"**Schema detectado:** `{schema}`  |  **Author:** `{author}`",
        f"**Nombre de archivo esperado:** `{ts_now}_{hu_label}.yaml`",
        "",
    ]

    # Diffs de entidades
    lines += [
        "## Cambios en entidades JPA",
        "",
        "Analizá los siguientes diffs para detectar:",
        "- Nuevas tablas (`@Entity` nuevo)",
        "- Columnas agregadas (`@Column` nuevo en entidad existente)",
        "- Columnas modificadas (tipo, nullable, nombre)",
        "- Relaciones nuevas (`@OneToMany`, `@ManyToOne`, `@JoinColumn`)",
        "- Enums nuevos (`@Enumerated`)",
        "",
    ]

    for filepath, diff in entity_diffs:
        lines += [
            f"### `{filepath}`",
            "",
            "```diff",
            diff.strip(),
            "```",
            "",
        ]

    # Migraciones recientes como referencia de formato
    if migrations:
        lines += [
            "## Migraciones existentes (referencia de formato y estilo)",
            "",
            "Usá estas migraciones como referencia para el formato, schemaName, autor y convenciones del proyecto.",
            "",
        ]
        for name, content in migrations:
            lines += [
                f"### `{name}`",
                "",
                "```yaml",
                content.strip(),
                "```",
                "",
            ]

    # Guidelines
    if guidelines:
        lines += [
            "## Lineamiento G81-POL-033 — Liquibase Global66",
            "",
            guidelines,
            "",
        ]

    # Instrucciones
    lines += [
        "## Instrucciones",
        "",
        f"1. **Analizá** el diff de las entidades y determiná exactamente qué cambió en el schema.",
        f"2. **Generá** el archivo `src/main/resources/db/migrations/{ts_now}_{hu_label}.yaml`.",
        "3. **Seguí estrictamente** el lineamiento G81-POL-033:",
        "   - Un changeSet por operación lógica (createTable / addColumn / createIndex / addForeignKey separados)",
        "   - IDs: `{timestamp}-{n}-{HU}` (ej: `20260510-1-AT-108`)",
        f"   - Author: `{author}`",
        f"   - schemaName: `{schema}` en todos los objetos",
        "   - `remarks` obligatorio en tabla y cada columna",
        "   - Tipos correctos: `INT`, `DATETIME`, `BIT(1)`, `ENUM('V1','V2')`, `DECIMAL(19,2)`",
        "   - Nombres: `PK_TABLE_ID`, `FK_ORIGIN_TARGET_FIELD`, `IDX_TABLE_COLUMN`, `UQ_TABLE_COLUMN`",
        "   - Bloque `rollback` en cada changeSet",
        "4. **Si detectás un enum Java** (`@Enumerated`), usá `ENUM('VAL1','VAL2')` en Liquibase, nunca `VARCHAR`.",
        "5. **Si es tabla nueva**, incluí `created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`.",
        "6. **Si agregás columna NOT NULL** a tabla con datos: incluí `defaultValue`.",
        "7. Al terminar, mostrá un resumen: changeSets generados, tablas/columnas afectadas.",
        "",
    ]

    return "\n".join(lines)

def main():
    args      = parse_args()
    cwd       = str(Path(args.cwd).resolve())
    cwd_path  = Path(cwd)

    # Verificar proyecto Java
    if not (cwd_path / "src" / "main" / "java").exists():
        print(json.dumps({"ok": False, "error": "No es un proyecto Java (src/main/java no existe)"}))
        sys.exit(1)

    branch_info = get_branch_info(cwd)
    hu          = args.hu or branch_info["hu"]
    user        = branch_info["user"]
    branch      = branch_info["branch"]
    merge_base  = get_merge_base(cwd)

    # Detectar entidades modificadas
    java_files     = get_modified_java_files(cwd, merge_base)
    entity_files   = [f for f in java_files if is_entity_file(cwd, f)]

    entity_diffs = []
    for filepath in entity_files:
        diff = get_file_diff(cwd, filepath, merge_base)
        if has_entity_changes_in_diff(diff):
            entity_diffs.append((filepath, diff))

    if not entity_diffs:
        print(json.dumps({
            "ok": False,
            "error": (
                "No se detectaron cambios en entidades JPA en el diff actual. "
                "Asegurate de tener commits con cambios en clases @Entity."
            )
        }))
        sys.exit(1)

    migrations = load_recent_migrations(cwd)
    schema     = infer_schema(migrations)
    author     = infer_author(migrations, user)
    guidelines = load_guidelines()
    prompt     = build_prompt(cwd, hu, user, branch, entity_diffs,
                              migrations, schema, author, guidelines)

    print(json.dumps({
        "ok":             True,
        "prompt":         prompt,
        "repo":           cwd_path.name,
        "hu":             hu,
        "entity_files":   [f for f, _ in entity_diffs],
        "schema":         schema,
        "author":         author,
    }))

if __name__ == "__main__":
    main()
