# Agent memory hygiene (PiB-managed fleet)

## Scope

**PiB-owned agent hosts only** (Peet’s Mac mini local Hermes fleet + `hermes-vps-01`).

This is **not** part of the public Windows / macOS / Linux customer runtime download. Customer runtimes should not auto-delete session files without an explicit managed-profile opt-in later.

## Doctrine

Canonical operating standard (Cowork wiki):

- `agents/partners/wiki/agent-memory-doctrine-2026-08-03.md`

Rules in short:

- Memory = facts / skills / decisions (file-first wiki, Research, CRM).
- Session `request_dump*` JSON is ephemeral, not memory.
- Default TTL for dumps: **30 days**.
- Vector `agent_memory_chunks` is an index on durable sources, not sole truth.

## Scripts (repo)

| Path | Role |
|---|---|
| `scripts/agent-memory-hygiene.py` | Dry-run or `--apply` prune of old `request_dump*` under `HERMES_HOME` |
| `scripts/install-agent-memory-hygiene.sh` | Install weekly automation on Mac (LaunchAgent) or VPS (systemd timer) |

```bash
# report
python3 scripts/agent-memory-hygiene.py --days 30

# prune dumps older than 30 days
python3 scripts/agent-memory-hygiene.py --days 30 --apply

# install weekly automation
./scripts/install-agent-memory-hygiene.sh          # Mac
sudo ./scripts/install-agent-memory-hygiene.sh --vps
```

## Schedule

- **Mac:** LaunchAgent `com.partnersinbiz.agent-memory-hygiene` — Sunday 04:15 local.
- **VPS:** `hermes-agent-memory-hygiene.timer` — Sunday 04:15 UTC ± 20 min jitter.

Logs:

- Mac: `~/.hermes/logs/agent-memory-hygiene.log`
- VPS: `/var/lib/hermes/logs/agent-memory-hygiene.log`

## What is deleted

Only files matching `request_dump*` older than `--days` (default 30).  
`session_*.json` is **not** deleted unless `--include-sessions` is passed (not used by the weekly installer).

## Runtime product note

Do **not** bake destructive prune into `runtime-installers` packages for general staff/customer machines without a managed-host gate. Fleet installers above are intentional and separate.
