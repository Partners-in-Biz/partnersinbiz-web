#!/usr/bin/env python3
"""Theo cron: release dependency-cleared agent tasks in PiB Website project."""
import json
import os
import sys
import urllib.request
import urllib.error

BASE = os.environ.get("PIB_API_BASE", "https://partnersinbiz.online/api/v1")
KEY = os.environ.get("PIB_AGENT_API_KEY") or os.environ.get("AI_API_KEY")
ORG = "pib-platform-owner"
PROJECT = "o9oakSxDgF3iHwlKmW1T"

HEADERS = {
    "Authorization": f"Bearer {KEY}",
    "X-Org-Id": ORG,
    "Content-Type": "application/json",
}

def api(path, method="GET", body=None):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = raw
        return e.code, parsed
    except Exception as e:
        return None, str(e)

def main():
    status, tasks = api(f"/projects/{PROJECT}/tasks")
    if status != 200:
        print(f"ERROR fetching tasks: status={status} body={tasks}")
        return 1
    if isinstance(tasks, dict):
        tasks = tasks.get("tasks", tasks.get("data", []))
    task_map = {}
    for t in tasks:
        tid = t.get("id") or t.get("_id")
        if tid:
            task_map[tid] = t
    print(f"Total tasks fetched: {len(task_map)}")

    candidates = []
    for tid, t in task_map.items():
        agent = t.get("assigneeAgentId")
        agent_status = t.get("agentStatus")
        column = t.get("columnId")
        deps = t.get("dependsOn") or []
        name = t.get("title") or t.get("name") or tid
        if agent and agent_status in ("blocked", "awaiting-input") and column == "blocked" and deps:
            candidates.append((tid, t, deps, name))
    print(f"Candidates (blocked/awaiting-input w/ deps): {len(candidates)}")

    done_statuses = {"done", "approved"}
    eligible = []
    for tid, t, deps, name in candidates:
        missing = []
        unresolved = []
        for d in deps:
            dep_id = d.get("taskId") or d.get("id") or d if isinstance(d, dict) else d
            dep = task_map.get(dep_id)
            if dep is None:
                missing.append(str(dep_id))
                continue
            dep_agent = dep.get("agentStatus")
            dep_review = dep.get("reviewStatus")
            dep_column = dep.get("columnId")
            if dep_agent in done_statuses or dep_review == "approved" or dep_column == "done":
                continue
            unresolved.append(f"{dep_id}(agent={dep_agent},review={dep_review},col={dep_column})")
        if missing or unresolved:
            print(f"  SKIP {tid} {name!r}: missing={missing} unresolved={unresolved}")
        else:
            eligible.append((tid, t, deps, name))
            print(f"  ELIGIBLE {tid} {name!r}")

    print(f"Eligible to release: {len(eligible)}")

    released = []
    for tid, t, deps, name in eligible:
        dep_names = []
        for d in deps:
            dep_id = d.get("taskId") or d.get("id") or d if isinstance(d, dict) else d
            dep = task_map.get(dep_id)
            dep_names.append(dep.get("title") or dep.get("name") or str(dep_id) if dep else str(dep_id))
        comment = (
            f"Auto-released by Theo: all dependencies complete "
            f"({', '.join(dep_names)}). Released for watcher pickup; "
            f"any approval gates still apply before execution."
        )
        cs, cb = api(f"/projects/{PROJECT}/tasks/{tid}/comments", "POST", {"text": comment})
        if cs not in (200, 201):
            print(f"  ERROR comment on {tid}: status={cs} body={cb}")
            continue
        ps, pb = api(f"/projects/{PROJECT}/tasks/{tid}", "PATCH", {
            "columnId": "todo",
            "agentStatus": "pending",
            "reviewStatus": "changes-requested",
        })
        if ps not in (200, 201):
            print(f"  ERROR patch on {tid}: status={ps} body={pb}")
            continue
        released.append(tid)
        print(f"  RELEASED {tid} {name!r}")

    if released:
        status, tasks2 = api(f"/projects/{PROJECT}/tasks")
        if status != 200:
            print(f"ERROR re-fetch: status={status} body={tasks2}")
            return 1
        if isinstance(tasks2, dict):
            tasks2 = tasks2.get("tasks", tasks2.get("data", []))
        by_id = { (t.get("id") or t.get("_id")): t for t in tasks2 }
        for tid in released:
            t = by_id.get(tid)
            if not t:
                print(f"  VERIFY FAIL: {tid} not found in re-fetch")
            else:
                print(f"  VERIFY {tid}: columnId={t.get('columnId')} agentStatus={t.get('agentStatus')} reviewStatus={t.get('reviewStatus')}")

    if not eligible:
        print("NO_ELIGIBLE")
    return 0

if __name__ == "__main__":
    sys.exit(main())
