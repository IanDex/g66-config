#!/usr/bin/env python3
"""
pr_review.py — AI-assisted PR review for G66 microservices.
Static analysis via analyze_diff.mjs; AI analysis via Anthropic API.
"""
import argparse, boto3, json, os, subprocess, sys, tempfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
VENDOR_DIR = SCRIPT_DIR.parent / "vendor" / "pr-review" / "scripts"
ANALYZE_MJS = VENDOR_DIR / "analyze_diff.mjs"
RENDER_MJS  = VENDOR_DIR / "render_report.mjs"

DEFAULT_LINEAMIENTOS = Path.home() / "Documents" / "g66-ia" / "g66-config" / "lineamientos"
GUIDELINES_PRIORITY = [
    "Servicios API REST (MS).md",
    "JPA+Hibernate.md",
    "Logs.md",
    "Cache.md",
    "Documentación de API (Swagger).md",
    "AWS API Gateway.md",
]

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--pr", required=True)
    p.add_argument("--repo")
    p.add_argument("--region", default="us-east-1")
    p.add_argument("--lineamientos", default=str(DEFAULT_LINEAMIENTOS))
    p.add_argument("--dry-run", action="store_true")
    return p.parse_args()

def infer_repo():
    try:
        r = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
        return Path(r.stdout.strip()).name
    except Exception:
        return None

def get_pr_info(pr_id, region):
    cc = boto3.client("codecommit", region_name=region)
    data = cc.get_pull_request(pullRequestId=str(pr_id))
    pr   = data["pullRequest"]
    t    = pr["pullRequestTargets"][0]
    src  = t["sourceReference"].replace("refs/heads/", "")
    dst  = t["destinationReference"].replace("refs/heads/", "")
    return src, dst, pr.get("title", "")

def get_diff(src, dst):
    subprocess.run(["git", "fetch", "origin", dst, src], capture_output=True)
    r = subprocess.run(
        ["git", "diff", f"origin/{dst}...origin/{src}"],
        capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    return r.stdout

def run_static_analysis(diff_text):
    with tempfile.NamedTemporaryFile(suffix=".diff", mode="w", encoding="utf-8", delete=False) as f:
        f.write(diff_text)
        diff_path = f.name
    try:
        r = subprocess.run(["node", str(ANALYZE_MJS), diff_path], capture_output=True, text=True)
        return json.loads(r.stdout).get("findings", []) if r.stdout.strip() else []
    except Exception:
        return []
    finally:
        os.unlink(diff_path)

def load_guidelines(lineamientos_dir):
    p = Path(lineamientos_dir)
    if not p.exists():
        return ""
    parts = []
    files = list(p.glob("*.md"))
    ordered = [p / name for name in GUIDELINES_PRIORITY if (p / name).exists()]
    rest    = [f for f in files if f not in ordered]
    for f in (ordered + rest)[:8]:
        try:
            parts.append(f"### {f.name}\n{f.read_text(encoding='utf-8', errors='replace')[:3000]}")
        except Exception:
            pass
    return "\n\n".join(parts)

def call_anthropic(diff_text, guidelines, static_findings, pr_title, pr_id, repo):
    import anthropic
    client = anthropic.Anthropic()

    static_summary = ""
    if static_findings:
        static_summary = "Static analysis already found:\n" + "\n".join(
            f"- [{f['severity'].upper()}] {f['message']} @ {f['filePath']}:{f.get('line','')}"
            for f in static_findings[:20]
        )

    diff_excerpt = diff_text[:12000] if len(diff_text) > 12000 else diff_text

    prompt = f"""You are a very critical senior developer at Global66. Review this CodeCommit PR.

PR #{pr_id} — {pr_title}
Repository: {repo}

{static_summary}

Do NOT repeat the static findings above. Focus on:
- Architectural concerns, wrong abstraction levels, business logic bugs
- Missing error handling, missing tests, missing Swagger docs
- Security issues, data leaks, wrong HTTP status codes
- Naming issues requiring domain context (provide 2-3 alternatives)
- Missing required PR conventions (missing Jira link, missing API Gateway update, missing DB migration)

G66 Backend Guidelines (priority order):
{guidelines[:6000]}

PR DIFF:
```diff
{diff_excerpt}
```

Respond ONLY with a JSON object (no markdown fences) following this exact schema:
{{
  "summary": "one paragraph summary in Spanish",
  "findings": [
    {{
      "type": "string",
      "severity": "high|medium|low",
      "confidence": 0.0-1.0,
      "filePath": "path/to/file.java",
      "line": 42,
      "isPrLine": true,
      "evidence": "the exact added line (+) from the diff",
      "message": "short finding title in Spanish",
      "comment": "PR comment to paste, written as a peer reviewer in Spanish, informal but professional",
      "suggestion": "concrete actionable fix in Spanish",
      "guideline": "filename.md"
    }}
  ]
}}
Return an empty findings array if nothing relevant is found. Only include findings anchored to added (+) lines."""

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}]
    )
    raw = msg.content[0].text.strip()
    # Strip markdown fences if model adds them
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
    return json.loads(raw)

def render_report(report_input):
    with tempfile.NamedTemporaryFile(suffix=".json", mode="w", encoding="utf-8", delete=False) as f:
        json.dump(report_input, f, ensure_ascii=False)
        input_path = f.name
    try:
        r = subprocess.run(["node", str(RENDER_MJS), input_path], capture_output=True, text=True)
        return r.stdout.strip()
    finally:
        os.unlink(input_path)

def main():
    args = parse_args()

    repo = args.repo or infer_repo()
    if not repo:
        print(json.dumps({"ok": False, "error": "No se pudo inferir el repo. Usa --repo."}))
        sys.exit(1)

    try:
        src, dst, pr_title = get_pr_info(args.pr, args.region)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Error obteniendo PR: {e}"}))
        sys.exit(1)

    diff_text = get_diff(src, dst)
    if not diff_text.strip():
        print(json.dumps({"ok": False, "error": "Diff vacío — verificá las ramas y el fetch."}))
        sys.exit(1)

    static_findings = run_static_analysis(diff_text)

    if args.dry_run:
        print(json.dumps({"ok": True, "static_findings": len(static_findings), "diff_lines": diff_text.count("\n")}))
        return

    guidelines = load_guidelines(args.lineamientos)

    try:
        ai_result = call_anthropic(diff_text, guidelines, static_findings, pr_title, args.pr, repo)
    except Exception as e:
        ai_result = {"summary": f"Error en IA: {e}", "findings": []}

    all_findings = static_findings + ai_result.get("findings", [])

    report_input = {
        "prId": args.pr,
        "repositoryName": repo,
        "summary": ai_result.get("summary", ""),
        "findings": all_findings,
    }

    report_path = render_report(report_input)

    counts = {"high": 0, "medium": 0, "low": 0}
    for f in all_findings:
        sev = f.get("severity", "low")
        if sev in counts:
            counts[sev] += 1
    score = max(0, 100 - counts["high"] * 15 - counts["medium"] * 7 - counts["low"] * 3)

    print(json.dumps({
        "ok": True,
        "report_path": report_path,
        "score": score,
        "findings": len(all_findings),
        "high": counts["high"],
        "medium": counts["medium"],
        "low": counts["low"],
        "pr_title": pr_title,
    }))

if __name__ == "__main__":
    main()
