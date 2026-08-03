#!/usr/bin/env python3
"""PiB agent-memory hygiene — report and optionally prune cold Hermes session dumps.

Doctrine: growth slope bankrupts long-lived agents. Request dumps and stale
session JSON are ephemeral, not memory. Default is dry-run.

Examples:
  python3 ~/.hermes/scripts/agent-memory-hygiene.py
  python3 ~/.hermes/scripts/agent-memory-hygiene.py --days 30 --apply
  python3 ~/.hermes/scripts/agent-memory-hygiene.py --days 14 --apply --include-sessions
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path


DEFAULT_HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))


@dataclass
class FileHit:
    path: str
    size: int
    age_days: float
    kind: str


def session_roots(hermes_home: Path) -> list[Path]:
    roots = [hermes_home / "sessions"]
    profiles = hermes_home / "profiles"
    if profiles.is_dir():
        for p in sorted(profiles.iterdir()):
            s = p / "sessions"
            if s.is_dir():
                roots.append(s)
    return [r for r in roots if r.exists()]


def classify(path: Path) -> str:
    name = path.name.lower()
    if "request_dump" in name:
        return "request_dump"
    if name.startswith("session_") or name.endswith(".json"):
        return "session_json"
    return "other"


def scan(hermes_home: Path, days: float, include_sessions: bool) -> list[FileHit]:
    now = time.time()
    cutoff = days * 86400
    hits: list[FileHit] = []
    for root in session_roots(hermes_home):
        for f in root.rglob("*"):
            if not f.is_file():
                continue
            kind = classify(f)
            if kind == "request_dump":
                pass
            elif kind == "session_json" and include_sessions:
                pass
            else:
                if kind != "request_dump":
                    continue
            age = now - f.stat().st_mtime
            if age < cutoff:
                continue
            st = f.stat()
            hits.append(
                FileHit(
                    path=str(f),
                    size=st.st_size,
                    age_days=age / 86400,
                    kind=kind,
                )
            )
    hits.sort(key=lambda h: h.size, reverse=True)
    return hits


def human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f}{unit}" if unit == "B" else f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}TB"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--hermes-home",
        type=Path,
        default=DEFAULT_HERMES_HOME,
        help=f"HERMES_HOME (default {DEFAULT_HERMES_HOME})",
    )
    ap.add_argument(
        "--days",
        type=float,
        default=30.0,
        help="Minimum age in days to consider for prune (default 30)",
    )
    ap.add_argument(
        "--apply",
        action="store_true",
        help="Actually delete matching files (default is dry-run)",
    )
    ap.add_argument(
        "--include-sessions",
        action="store_true",
        help="Also target session_*.json (more aggressive; dumps only by default)",
    )
    ap.add_argument(
        "--json",
        action="store_true",
        help="Machine-readable summary on stdout",
    )
    ap.add_argument(
        "--limit",
        type=int,
        default=25,
        help="Max paths to print in human mode (default 25)",
    )
    args = ap.parse_args()

    hermes_home = args.hermes_home.expanduser().resolve()
    if not hermes_home.is_dir():
        print(f"HERMES_HOME not found: {hermes_home}", file=sys.stderr)
        return 2

    hits = scan(hermes_home, args.days, args.include_sessions)
    total = sum(h.size for h in hits)
    by_kind: dict[str, int] = {}
    for h in hits:
        by_kind[h.kind] = by_kind.get(h.kind, 0) + h.size

    summary = {
        "hermes_home": str(hermes_home),
        "days": args.days,
        "apply": args.apply,
        "include_sessions": args.include_sessions,
        "file_count": len(hits),
        "bytes": total,
        "human_bytes": human(total),
        "by_kind_bytes": by_kind,
        "deleted": 0,
        "errors": [],
    }

    if args.apply:
        deleted = 0
        errors = []
        for h in hits:
            try:
                Path(h.path).unlink(missing_ok=True)
                deleted += 1
            except OSError as e:
                errors.append(f"{h.path}: {e}")
        summary["deleted"] = deleted
        summary["errors"] = errors

    if args.json:
        print(json.dumps({**summary, "top": [asdict(h) for h in hits[:50]]}, indent=2))
    else:
        mode = "APPLY" if args.apply else "DRY-RUN"
        print(f"agent-memory-hygiene [{mode}] home={hermes_home}")
        print(f"  threshold: older than {args.days:.0f}d")
        print(f"  targets: request_dump" + (" + session_json" if args.include_sessions else " only"))
        print(f"  candidates: {len(hits)} files · {human(total)}")
        for k, v in sorted(by_kind.items()):
            print(f"    {k}: {human(v)}")
        print(f"  top {min(args.limit, len(hits))}:")
        for h in hits[: args.limit]:
            print(f"    {human(h.size):>8}  {h.age_days:5.0f}d  {h.kind:12}  {h.path}")
        if args.apply:
            print(f"  deleted: {summary['deleted']}")
            if summary["errors"]:
                print(f"  errors: {len(summary['errors'])}")
                for e in summary["errors"][:10]:
                    print(f"    {e}")
        else:
            print("  (no files deleted — re-run with --apply to prune)")
        print("  doctrine: agents/partners/wiki/agent-memory-doctrine-2026-08-03.md")

    return 1 if summary.get("errors") else 0


if __name__ == "__main__":
    raise SystemExit(main())
