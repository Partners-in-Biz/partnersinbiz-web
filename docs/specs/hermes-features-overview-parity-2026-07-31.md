# Hermes Features Overview parity matrix — PiB Messages/agent runtime

Last updated: 2026-07-31  
Source list: [Hermes Features Overview](https://hermes-agent.nousresearch.com/docs/user-guide/features/overview)

Architecture contract: PiB Messages remains **Firestore + `/v1/runs`**, not full Hermes SessionDB / `slash.exec` Desktop parity. Features below are productized through PiB adapters unless marked deferred.

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Tools & Toolsets | **complete** (this goal) | Per-agent/chat toolset enablement via `lib/hermes-features/toolsets` + API |
| 2 | Skills progressive disclosure | **complete** (this goal) | Progressive metadata + load-on-demand selection into dispatch |
| 3 | Persistent MEMORY/USER | **complete** (this goal) | Curated cross-session memory store per agent/org |
| 4 | Context files multi-format | **complete** (this goal) | Discovery order for .hermes.md, AGENTS.md, CLAUDE.md, SOUL.md, .cursorrules |
| 5 | Context refs @file/@folder/@diff/@url | **complete** (this goal) | Expansion module for all four injectors |
| 6 | Checkpoints & /rollback | **complete** (this goal) | Snapshot + restore control; `/rollback` slash |
| 7 | Cron scheduled tasks | **complete** (this goal) | NL/cron create/list/pause/resume/edit |
| 8 | Subagent delegation | **complete** (this goal) | Spawn + observe bounded children |
| 9 | Code execution | **complete** (this goal) | Sandboxed execute path when toolset enabled |
| 10 | Event hooks | **complete** (this goal) | Create/list/enable/disable hook kinds |
| 11 | Batch processing | **complete** (this goal) | Structured per-item batch results in PiB (not ShareGPT training export) |
| 12 | Voice mode full Discord | **partial** | Hermes-backed STT/TTS readiness; Discord voice deferred |
| 13 | Wake word | **deferred** | Non-web client; not in portal scope |
| 14 | Browser automation | **complete** (this goal) | Backend readiness + navigate/extract contract |
| 15 | Vision & image paste | **complete** (this goal) | Vision path for attachments + readiness |
| 16 | Image generation | **complete** (this goal) | Hermes image-gen tool path + readiness |
| 17 | Hermes multi-provider TTS | **complete** (this goal) | Provider registry + speak path (not browser-only) |
| 18 | MCP servers | **complete** (this goal) | stdio/HTTP register/list + tool filter |
| 19 | Provider routing | **complete** (this goal) | sort/allow/deny/priority policy |
| 20 | Credential pools | **complete** (this goal) | multi-key rotate-on-failure decision |
| 21 | Prompt caching SessionDB | **partial** | Documented; PiB uses `/v1/runs` history injection |
| 22 | External memory providers | **complete** (this goal) | At least one adapter beyond MEMORY/USER |
| 23 | Public API server product | **deferred** | Internal Hermes API only (non-goal) |
| 24 | IDE ACP | **deferred** | Non-goal |
| 25 | Batch ShareGPT training | **deferred** | Structured batch only (non-goal) |
| 26 | Personality / SOUL presets | **complete** (this goal) | List/apply presets |
| 27 | Skins & themes | **deferred** | CLI-only non-goal |
| 28 | Plugins | **complete** (this goal) | List/install API for tools/hooks plugins |

## Approximate (honest partial)

| Feature | Why partial |
|---------|-------------|
| `/goal` | PiB bridge + auto-continue, not native gateway `slash.exec` goal loop |
| Slash registry | PiB product commands + Hermes bridges, not full Desktop command registry |
| Fallback providers | Profile + system defaults; not full Desktop routing UI |
| Prompt caching | No SessionDB-owned cross-session Anthropic cache product surface |
