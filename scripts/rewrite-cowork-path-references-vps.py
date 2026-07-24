#!/usr/bin/env python3
"""Rewrite flat Partners-era Cowork path tokens under /var/lib/hermes/Cowork/partners and profiles."""
from __future__ import annotations

import json
import os
import re
import sys

NEST = "partners"
ROOT = os.environ.get("ROOT", f"/var/lib/hermes/Cowork/{NEST}")
DRY = os.environ.get("DRY", "1") == "1"
TEXT_NAMES = {"AGENTS.md", "CLAUDE.md", "SOUL.md", "SOUL.local.md", "AGENTS.local.md"}
SKIP = {"node_modules", ".git", ".next", "dist", "build", ".turbo", ".claude", "venv", "__pycache__"}
RESERVED = {
    "Cowork",
    NEST,
    "Partners in Biz — Client Growth",
    "Side Projects",
    "YouTube Business",
}
PATTERNS = [
    re.compile(r"~/Cowork/[^\s`\"'<>\])|,]+"),
    re.compile(r"/var/lib/hermes/Cowork/[^\s`\"'<>\])|,]+"),
    re.compile(r"/Users/[^/\s]+/Cowork/[^\s`\"'<>\])|,]+"),
]


def is_legacy(path: str) -> bool:
    match = re.match(
        r"^(?:~/Cowork|/var/lib/hermes/Cowork|/Users/[^/]+/Cowork)/([^/]+)(?:/.*)?$",
        path,
    )
    if not match:
        return False
    segment = match.group(1)
    return segment not in RESERVED and not segment.startswith(".")


def rewrite_path(path: str) -> str | None:
    if not is_legacy(path):
        return None
    if path.startswith("~/Cowork/"):
        return f"~/Cowork/{NEST}/{path[len('~/Cowork/'):]}"
    if path.startswith("/var/lib/hermes/Cowork/"):
        return f"/var/lib/hermes/Cowork/{NEST}/{path[len('/var/lib/hermes/Cowork/'):]}"
    match = re.match(r"^(/Users/[^/]+/Cowork)/(.*)$", path)
    if match:
        return f"{match.group(1)}/{NEST}/{match.group(2)}"
    return None


def rewrite_text(text: str) -> tuple[str, int]:
    changes = 0

    def repl(match: re.Match[str]) -> str:
        nonlocal changes
        raw = match.group(0)
        core, trailing = raw, ""
        while core and core[-1] in ".,;:!?":
            trailing = core[-1] + trailing
            core = core[:-1]
        rewritten = rewrite_path(core)
        if not rewritten or rewritten == core:
            return raw
        changes += 1
        return rewritten + trailing

    out = text
    for pattern in PATTERNS:
        out = pattern.sub(repl, out)
    return out, changes


def main() -> int:
    changed: list[dict[str, object]] = []
    if os.path.isdir(ROOT):
        for dirpath, dirnames, filenames in os.walk(ROOT):
            dirnames[:] = [d for d in dirnames if d not in SKIP and not d.startswith(".")]
            for name in filenames:
                full = os.path.join(dirpath, name)
                if name in TEXT_NAMES:
                    before = open(full, "r", encoding="utf-8", errors="ignore").read()
                    after, count = rewrite_text(before)
                    if count:
                        if not DRY:
                            open(full, "w", encoding="utf-8").write(after)
                        changed.append({"path": full, "changes": count, "kind": "text"})
                elif name == ".pib-workspace.json":
                    try:
                        data = json.load(open(full, "r", encoding="utf-8"))
                    except Exception:
                        continue
                    count = 0
                    for key in ("localPath", "vpsPath", "agentDomainPath", "localAgentDomainPath"):
                        value = data.get(key)
                        if isinstance(value, str):
                            rewritten = rewrite_path(value.strip())
                            if rewritten and rewritten != value:
                                data[key] = rewritten
                                count += 1
                    if count:
                        if not DRY:
                            open(full, "w", encoding="utf-8").write(json.dumps(data, indent=2) + "\n")
                        changed.append({"path": full, "changes": count, "kind": "json"})

    profiles = "/var/lib/hermes/profiles"
    if os.path.isdir(profiles):
        for name in os.listdir(profiles):
            soul = os.path.join(profiles, name, "SOUL.md")
            if not os.path.isfile(soul):
                continue
            before = open(soul, "r", encoding="utf-8", errors="ignore").read()
            after, count = rewrite_text(before)
            if count:
                if not DRY:
                    open(soul, "w", encoding="utf-8").write(after)
                changed.append({"path": soul, "changes": count, "kind": "text"})

    print(json.dumps(changed))
    return 0


if __name__ == "__main__":
    sys.exit(main())
