# Hermes Features Overview parity matrix — PiB Messages/agent runtime

Last updated: 2026-07-31  
Source list: [Hermes Features Overview](https://hermes-agent.nousresearch.com/docs/user-guide/features/overview)

## Architecture contract (criterion 5)

PiB Messages remains **Firestore + `/v1/runs`**, not full Hermes SessionDB / `slash.exec` Desktop parity. Features are productized through the `lib/hermes-features/*` control plane, Messages slash commands, and `GET/POST /api/v1/admin/hermes-features`.

| Approximate / partial (honest) | Why |
|--------------------------------|-----|
| `/goal` | PiB bridge + auto-continue, not native gateway `slash.exec` goal loop |
| Slash registry | PiB product commands + Hermes bridges, not full Desktop command registry |
| Code execution | Sandboxed trivial subset in PiB + toolset gate; full Hermes `execute_code` RPC when agent toolset enabled on runtime |
| Batch | Structured per-item results in PiB — **not** ShareGPT training export |
| Voice | Hermes TTS/STT readiness + speak path; Discord voice **deferred** |
| Prompt caching | Documented; PiB reinjects `/v1/runs` history — no SessionDB 1h Anthropic cache product surface |

## Status matrix (1–28)

| # | Feature | Status | Product surface |
|---|---------|--------|-----------------|
| 1 | Tools & Toolsets | **complete** | `/toolsets`, admin API `toolsets.*`, dispatch block |
| 2 | Skills progressive disclosure | **complete** | catalog without bodies + select/load API + dispatch |
| 3 | Persistent MEMORY/USER | **complete** | `/memory`, `memory.*` API, dispatch injection |
| 4 | Context files multi-format | **complete** | discovery order + dispatch; workspace file map |
| 5 | Context refs @file/@folder/@diff/@url | **complete** | expand modules + message token scan |
| 6 | Checkpoints & /rollback | **complete** | `/rollback`, checkpoint create/restore API |
| 7 | Cron scheduled tasks | **complete** | create/list/pause/resume/edit API |
| 8 | Subagent delegation | **complete** | spawn + observe bounded children API |
| 9 | Code execution | **partial** | toolset gate + sandboxed subset; full RPC on Hermes |
| 10 | Event hooks | **complete** | create/list/enable/disable hook kinds |
| 11 | Batch processing | **partial** | structured batch results (not ShareGPT export) |
| 12 | Voice mode full Discord | **partial** | readiness + STT/TTS paths; Discord voice deferred |
| 13 | Wake word | **deferred** | non-web client |
| 14 | Browser automation | **complete** | backend readiness + navigate/extract contract |
| 15 | Vision & image paste | **complete** | readiness when vision model bound; attachments on runs |
| 16 | Image generation | **complete** | readiness signal for Hermes image-gen path |
| 17 | Hermes multi-provider TTS | **complete** | provider registry + `hermesSpeakPath` |
| 18 | MCP servers | **complete** | stdio/HTTP register/list + tool filter |
| 19 | Provider routing | **complete** | sort/allow/deny/priority policy |
| 20 | Credential pools | **complete** | multi-key rotate-on-failure decision |
| 21 | Prompt caching SessionDB | **partial** | architecture note only |
| 22 | External memory providers | **complete** | mem0/honcho/openviking adapter + lookup |
| 23 | Public API server product | **deferred** | internal Hermes API only |
| 24 | IDE ACP | **deferred** | non-goal |
| 25 | Batch ShareGPT training | **deferred** | non-goal |
| 26 | Personality / SOUL presets | **complete** | `/personality`, apply API |
| 27 | Skins & themes | **deferred** | CLI-only non-goal |
| 28 | Plugins | **complete** | list/install API |

## Operator entry points

- Messages slash: `/toolsets`, `/memory`, `/rollback`, `/personality`, `/hermes-features`, `/goal`
- Admin API: `/api/v1/admin/hermes-features` (GET sections + POST actions)
- Dispatch injection: `hermesFeaturesService.buildDispatchBlock` into conversation messages route
