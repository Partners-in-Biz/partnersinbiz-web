---
name: youtube-studio-ops
description: >
  Stub skill for the Partners in Biz YouTube Studio module: channels, videos, release plans, clip candidates, and publish packets. Owner: maya. Full request/response docs not yet written. Use this skill whenever the user mentions YouTube Studio, channel linking, video release plans, or clip/repurpose workflows.
---

# YouTube Studio Ops — Partners in Biz Platform API (stub)

**Status: stub.** This skill points at a real, shipped API surface under `/api/v1/youtube-studio/*` that has not yet been fully documented (request/response shapes, per-route auth level, and validated agent workflows). Read the route source under `app/api/v1/youtube-studio/**` before relying on undocumented behavior, and do not assume a shape not shown here.

## Owner & scope

- Owner: `maya`
- Scope: YouTube channel + video production/release pipeline: channel adoption/linking, source assets, video import/repurpose, render jobs, clip candidates, production drafts, release plans (with publish action), publish packets, series, analytics, and agent jobs.
- Base path: `https://partnersinbiz.online/api/v1/youtube-studio`

## Auth (mandatory)

Interactive Hermes runs use the **user-delegation** token injected by Messages / minted via `system-auth` (`Authorization: Bearer pib_dlg_…` + `X-Org-Id`).

- Prefer the injected delegation token for all `/api/v1/*` calls in a human-triggered run.
- `AI_API_KEY` / agent system keys are **cron/system only**.
- Never claim a write succeeded without read-back (see pack `verificationContract` / skill success gate).
- See skill `system-auth` for mint/resolve rules.

## API routes to document next

- `GET/POST /youtube-studio/channels`
- `GET/PATCH /youtube-studio/channels/[id]`
- `POST /youtube-studio/channels/adopt`
- `GET/POST /youtube-studio/channels/links`
- `GET/POST /youtube-studio/videos`
- `GET/PATCH /youtube-studio/videos/[id]`
- `POST /youtube-studio/videos/import`
- `POST /youtube-studio/videos/[id]/repurpose`
- `POST /youtube-studio/videos/[id]/open-in-canvas (see creative-canvas-ops)`
- `GET/POST /youtube-studio/source-assets`
- `GET/POST /youtube-studio/render-jobs`
- `GET/POST /youtube-studio/clip-candidates`
- `GET/POST /youtube-studio/production-drafts`
- `GET/POST /youtube-studio/release-plans`
- `POST /youtube-studio/release-plans/[id]/publish`
- `GET/POST /youtube-studio/publish-packets`
- `GET/POST /youtube-studio/series`
- `GET /youtube-studio/analytics`
- `POST /youtube-studio/analytics/ingest`
- `GET/POST /youtube-studio/agent-jobs`

## Next steps to un-stub this skill

- Document request/response shapes and the auth level (`viewer`/`member`/`admin`/`system`/delegation-only) per route above.
- Add copy-paste-ready example payloads once shapes are confirmed against route source.
- Add an `## Agent patterns` / workflow-guide section once at least one end-to-end flow has been run and verified (write → read-back → report).
- Register any newly-confirmed write-then-verify contract in the pack `verificationContract`.

## Cross-references

- video-editor-ops (source render pipeline)
- social-media-manager (cross-post repurposed clips)
- content-engine
