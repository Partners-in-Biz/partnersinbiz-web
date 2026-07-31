# Hermes Features Overview parity matrix — PiB Messages/agent runtime

Last updated: 2026-07-31 (skeptic-hardened)  
Source: [Hermes Features Overview](https://hermes-agent.nousresearch.com/docs/user-guide/features/overview)

## Architecture contract (criterion 5)

PiB Messages remains **Firestore + `/v1/runs`**, not Hermes SessionDB / `slash.exec`.  
Durable control-plane state lives in Firestore collection **`hermes_features`** (production) or the same repository interface in-memory under Jest.

| Claim honesty rule | Rule |
|--------------------|------|
| **complete** | Durable store + operable product path that reads back after process restart (Firestore) or proven repository contract; Messages/admin can use it |
| **partial** | Real path exists but limited (sandbox, env-gated, sync optional, not full Hermes Desktop) |
| **stub** | Policy/catalog only without durable product path — **none remaining for core surfaces after this revision** |
| **deferred** | Explicit non-goal |

## Status matrix (1–28)

| # | Feature | Status | What is actually operable |
|---|---------|--------|---------------------------|
| 1 | Tools & Toolsets | **complete** | Durable enable/disable/set; `/toolsets`; dispatch injection |
| 2 | Skills progressive disclosure | **complete** | Catalog without bodies; select+load bodies into dispatch; Messages seeds catalog from agent skills |
| 3 | Persistent MEMORY/USER | **complete** | Durable get/set/append; `/memory`; dispatch injection |
| 4 | Context files multi-format | **complete** | Discovers `.hermes.md`/`AGENTS.md`/`CLAUDE.md`/`SOUL.md`/`.cursorrules` from bound workspace FS when path exists |
| 5 | Context refs @file/@folder/@diff/@url | **complete** | Expansion with FS/git/url deps; dispatch token scan from workspace |
| 6 | Checkpoints & /rollback | **complete** | Durable snapshots; auto-checkpoint on dispatch when workspace bound; `/rollback` writes files via workspace FS |
| 7 | Cron scheduled tasks | **partial→operable** | Durable jobs; optional Hermes admin sync; **`cron.fire` / `/api/cron/hermes-features` creates Hermes `/v1/runs`** with run ids |
| 8 | Subagent delegation | **partial→operable** | **`delegation.spawn` creates child Hermes runs** with observable `runId`/`runDocId` stored durably |
| 9 | Code execution | **partial** | Toolset gate + sandboxed print/arithmetic subset only — not full Hermes `execute_code` RPC |
| 10 | Event hooks | **partial** | Durable create/list/enable/disable config — not live gateway hook process injection |
| 11 | Batch processing | **partial** | Durable per-item results; default is structured echo unless runner injected — **not** ShareGPT export |
| 12 | Voice mode full Discord | **partial** | Env readiness + TTS tool hint; Discord voice **deferred** |
| 13 | Wake word | **deferred** | non-web |
| 14 | Browser automation | **partial** | Env readiness + navigate/extract contract when backend configured; live Browserbase/CDP depends on Hermes profile |
| 15 | Vision | **partial** | Ready when vision model env bound; attachments still use Messages path |
| 16 | Image generation | **partial** | Ready when FAL/image-gen env present |
| 17 | Multi-provider TTS | **partial** | Ready when `HERMES_TTS_PROVIDER` set; returns Hermes tool hint (not browser-only claim) |
| 18 | MCP servers | **partial** | Durable register/list/filter; **not** automatic profile file rewrite on VPS until admin sync path used |
| 19 | Provider routing | **partial** | Durable sort/allow/deny/priority policy applied in PiB; profile-level Hermes routing may still differ |
| 20 | Credential pools | **partial** | Durable fingerprint pools + rotate-on-failure decision; secrets stay in llm-providers path |
| 21 | Prompt caching SessionDB | **partial** | Not owned; history reinjection only |
| 22 | External memory providers | **partial** | Bindings durable; lookup **ready only with real adapter/credentials** (no fabricated hits) |
| 23 | Public API server product | **deferred** | |
| 24 | IDE ACP | **deferred** | |
| 25 | Batch ShareGPT training | **deferred** | |
| 26 | Personality / SOUL presets | **complete** | Durable apply; `/personality`; dispatch injection |
| 27 | Skins & themes | **deferred** | |
| 28 | Plugins | **partial** | Durable install flags/catalog; not full `hermes plugins` remote install UI |

## Operator entry points

- Messages: `/toolsets` `/memory` `/rollback` `/personality` `/hermes-features` `/goal`
- Admin: `GET/POST /api/v1/admin/hermes-features`
- Cron fire worker: `GET /api/cron/hermes-features?orgId=…` (Bearer `CRON_SECRET`)
- Dispatch: `buildHermesFeaturesDispatchBlock` in conversation messages route

## Approximate bridges (not claimed complete)

- `/goal` — PiB bridge + auto-continue
- Slash registry — PiB product set, not full Desktop registry
