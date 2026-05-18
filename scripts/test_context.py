#!/usr/bin/env python3
"""
test_context.py — Construye el prompt de testing para lanzar Claude.
Analiza clases modificadas en git diff y carga guidelines de java-testing.
"""
import argparse, json, os, subprocess, sys
from pathlib import Path

WORKSPACE_DIR  = Path.home() / "Documents" / "ms-g66"
TESTING_RULE   = WORKSPACE_DIR / "ai-context" / "shared" / "rules" / "groups" / "backend" / "testing.md"
SKILL_MD       = Path.home() / ".claude" / "skills" / "java-testing" / "SKILL.md"

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--cwd",    default=os.getcwd())
    p.add_argument("--repo-id", help="ID del repo en ai-context (opcional)")
    return p.parse_args()

def git(repo: str, args: list[str]) -> str:
    result = subprocess.run(
        ["git", "-C", repo] + args,
        capture_output=True, text=True
    )
    return result.stdout.strip()

def get_modified_java_files(cwd: str) -> list[str]:
    """Archivos Java modificados respecto a development/master."""
    for base in ("origin/development", "origin/master", "HEAD~3"):
        try:
            merge_base = git(cwd, ["merge-base", "HEAD", base])
            if merge_base:
                files = git(cwd, ["diff", "--name-only", merge_base, "HEAD", "--", "*.java"])
                result = [f for f in files.splitlines() if f and "Test" not in f and "src/main/" in f]
                if result:
                    return result
        except Exception:
            continue
    return []

def scan_main_classes(cwd: str) -> list[str]:
    """Todas las clases en src/main/java/."""
    main_dir = Path(cwd) / "src" / "main" / "java"
    if not main_dir.exists():
        return []
    files = []
    for f in main_dir.rglob("*.java"):
        rel = str(f.relative_to(cwd)).replace("\\", "/")
        files.append(rel)
    return sorted(files)

def find_untested(cwd: str, main_files: list[str]) -> list[str]:
    """Clases sin test correspondiente."""
    test_dir = Path(cwd) / "src" / "test" / "java"
    untested = []
    for f in main_files:
        name = Path(f).stem
        test_name = name + "Test.java"
        if not list(test_dir.rglob(test_name)):
            untested.append(f)
    return untested

def load_testing_guidelines() -> str:
    parts = []

    # 1. testing.md de ai-context (G66 específico)
    if TESTING_RULE.exists():
        parts.append("## G66 Backend Testing Rules\n\n" + TESTING_RULE.read_text(encoding="utf-8"))

    # 2. SKILL.md de java-testing (patrones generales)
    if SKILL_MD.exists():
        content = SKILL_MD.read_text(encoding="utf-8")
        # Saltar front matter YAML
        if content.startswith("---"):
            end = content.find("---", 3)
            if end != -1:
                content = content[end + 3:].lstrip()
        parts.append("## Java Testing Skill Patterns\n\n" + content)

    return "\n\n---\n\n".join(parts)

def get_branch_info(cwd: str) -> dict:
    branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])
    parts = branch.split("/")
    hu = None
    if len(parts) >= 3:
        hu = parts[-1].upper()
    return {"branch": branch, "hu": hu}

def build_prompt(cwd: str, modified: list[str], untested: list[str],
                 all_main: list[str], guidelines: str, branch_info: dict) -> str:
    repo_name = Path(cwd).name
    hu = branch_info.get("hu", "")
    branch = branch_info.get("branch", "")

    lines = [
        f"# Escribir tests — {repo_name}",
        "",
        f"**Repo:** `{repo_name}`  |  **Rama:** `{branch}`" + (f"  |  **HU:** `{hu}`" if hu else ""),
        "",
    ]

    if modified:
        lines += [
            "## Clases modificadas en esta rama (prioridad alta)",
            "",
            "Estas clases fueron modificadas en el diff actual. Empieza por sus tests:",
            "",
        ]
        for f in modified[:20]:
            lines.append(f"- `{f}`")
        lines.append("")

    if untested:
        lines += [
            "## Clases sin test",
            "",
            f"Se encontraron **{len(untested)}** clases sin test correspondiente.",
            "Prioriza las del diff; las demás según relevancia de dominio:",
            "",
        ]
        for f in untested[:30]:
            lines.append(f"- `{f}`")
        lines.append("")

    total = len(all_main)
    tested_count = total - len(untested)
    lines += [
        f"**Cobertura base estimada:** {tested_count}/{total} clases tienen test.",
        "",
    ]

    lines += [
        "## Guidelines de testing G66",
        "",
        guidelines,
        "",
    ]

    lines += [
        "## Instrucciones",
        "",
        "1. **Lee primero** los archivos fuente de las clases modificadas.",
        "2. **Verifica** si ya existe un test file para cada clase (`src/test/java/`).",
        "3. **Si existe** → agrega `@Nested` blocks o métodos `@Test` nuevos sin tocar los existentes.",
        "4. **Si no existe** → crea el test class completo siguiendo los patrones de arriba.",
        "5. **Crea fixtures JSON** en `src/test/resources/data/` para cada DTO/entity que no tenga uno.",
        "6. **No crees datos mock en código** — solo JSON fixtures vía `FileUtils.loadObject(...)`.",
        "7. Al terminar, muestra el TEST GENERATION SUMMARY con archivos creados/modificados.",
        "",
        "Objetivo: 4 tipos de cobertura por método (happy path, negativo, edge case, branch conditions).",
        "",
    ]

    return "\n".join(lines)

def main():
    args = parse_args()
    cwd = str(Path(args.cwd).resolve())

    # Verificar que es un proyecto Java
    if not (Path(cwd) / "src" / "main" / "java").exists():
        print(json.dumps({"ok": False, "error": "No es un proyecto Java (src/main/java no existe)"}))
        sys.exit(1)

    branch_info  = get_branch_info(cwd)
    modified     = get_modified_java_files(cwd)
    all_main     = scan_main_classes(cwd)
    untested     = find_untested(cwd, all_main)
    guidelines   = load_testing_guidelines()
    prompt       = build_prompt(cwd, modified, untested, all_main, guidelines, branch_info)

    print(json.dumps({
        "ok": True,
        "prompt": prompt,
        "repo": Path(cwd).name,
        "modified_count": len(modified),
        "untested_count": len(untested),
        "total_classes": len(all_main),
        "hu": branch_info.get("hu"),
    }))

if __name__ == "__main__":
    main()
