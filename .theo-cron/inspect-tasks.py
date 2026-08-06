import json, os, urllib.request
BASE = os.environ.get("PIB_API_BASE", "https://partnersinbiz.online/api/v1")
KEY = os.environ.get("PIB_AGENT_API_KEY") or os.environ.get("AI_API_KEY")
ORG = "pib-platform-owner"
PROJECT = "o9oakSxDgF3iHwlKmW1T"
req = urllib.request.Request(f"{BASE}/projects/{PROJECT}/tasks", headers={
    "Authorization": f"Bearer {KEY}", "X-Org-Id": ORG, "Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=60) as resp:
    data = json.loads(resp.read().decode())
print("TOP-LEVEL TYPE:", type(data).__name__)
if isinstance(data, dict):
    print("TOP-LEVEL KEYS:", list(data.keys()))
    tasks = data.get("tasks", data.get("data", []))
else:
    tasks = data
print("TASKS COUNT:", len(tasks))
if tasks:
    sample = tasks[0]
    print("SAMPLE TASK KEYS:", sorted(sample.keys()))
print("---- summary of all tasks ----")
for t in tasks:
    tid = t.get("id") or t.get("_id")
    print(json.dumps({
        "id": tid,
        "title": t.get("title") or t.get("name"),
        "assigneeAgentId": t.get("assigneeAgentId"),
        "agentStatus": t.get("agentStatus"),
        "reviewStatus": t.get("reviewStatus"),
        "columnId": t.get("columnId"),
        "dependsOn": t.get("dependsOn"),
    }, default=str)[:500])
