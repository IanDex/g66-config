import json, base64, requests
from pathlib import Path

cfg  = json.loads((Path.home() / ".claude" / "settings.json").read_text())
e    = cfg["mcpServers"]["atlassian"]["env"]
auth = base64.b64encode(f"{e['ATLASSIAN_EMAIL']}:{e['ATLASSIAN_API_TOKEN']}".encode()).decode()
hdrs = {"Authorization": f"Basic {auth}", "Content-Type": "application/json"}

hu = input("HU (ej: AT-108): ").strip()
r  = requests.get(f"{e['ATLASSIAN_BASE_URL']}/rest/api/3/issue/{hu}?expand=names", headers=hdrs)
if r.status_code != 200:
    print(f"Error {r.status_code}: {r.text[:300]}")
    exit(1)

data = r.json()
for fname in ["PR en dev", "PR en CI", "PR en Prod"]:
    fid = next((k for k, v in data["names"].items() if v == fname), None)
    if not fid:
        print(f"{fname:12} → campo no encontrado en Jira")
        continue
    val = data["fields"].get(fid)
    if not val or not val.get("content"):
        print(f"{fname:12} → (vacío)")
        continue
    texts = []
    for block in val["content"]:
        for node in block.get("content", []):
            if node.get("type") == "text" and node.get("text", "").strip():
                texts.append(node["text"])
    print(f"{fname:12} → {len(texts)} URL(s):")
    for t in texts:
        print(f"               {t}")
