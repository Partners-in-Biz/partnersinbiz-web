---
name: video-editor-ops
description: >
  Stub skill for the Partners in Biz Video Editor module: projects, timelines, render jobs, transcripts/captions, TTS, stock footage, LUTs, and templates. Owner: maya. Full request/response docs not yet written. Use this skill whenever the user mentions video editor projects, render jobs, transcripts, captions, TTS voices, LUTs, or video templates on the platform.
---

# Video Editor Ops — Partners in Biz Platform API (stub)

**Status: stub.** This skill points at a real, shipped API surface under `/api/v1/video-editor/*` that has not yet been fully documented (request/response shapes, per-route auth level, and validated agent workflows). Read the route source under `app/api/v1/video-editor/**` before relying on undocumented behavior, and do not assume a shape not shown here.

## Owner & scope

- Owner: `maya`
- Scope: Programmatic video editing on Partners in Biz: editor projects, render jobs, transcript/caption generation, text-to-speech, reframe, stock footage search/import, LUTs, media previews, proxy ledger, and reusable templates.
- Base path: `https://partnersinbiz.online/api/v1/video-editor`

## Auth (mandatory)

Interactive Hermes runs use the **user-delegation** token injected by Messages / minted via `system-auth` (`Authorization: Bearer pib_dlg_…` + `X-Org-Id`).

- Prefer the injected delegation token for all `/api/v1/*` calls in a human-triggered run.
- `AI_API_KEY` / agent system keys are **cron/system only**.
- Never claim a write succeeded without read-back (see pack `verificationContract` / skill success gate).
- See skill `system-auth` for mint/resolve rules.

## API routes to document next

- `GET/POST /video-editor/projects`
- `GET/PATCH /video-editor/projects/[id]`
- `POST /video-editor/projects/[id]/render`
- `POST /video-editor/projects/[id]/reframe`
- `POST /video-editor/projects/[id]/captions/generate`
- `POST /video-editor/projects/[id]/tts`
- `GET/POST /video-editor/render-jobs`
- `GET /video-editor/render-jobs/[id]`
- `GET/POST /video-editor/transcripts`
- `GET /video-editor/transcripts/[id]`
- `POST /video-editor/transcripts/[id]/translate`
- `GET /video-editor/tts/voices`
- `POST /video-editor/media/[id]/beats`
- `GET/POST /video-editor/stock/search`
- `POST /video-editor/stock/import`
- `GET/POST /video-editor/luts`
- `GET /video-editor/luts/[id]`
- `GET/POST /video-editor/templates`
- `GET /video-editor/templates/[id]`
- `POST /video-editor/templates/[id]/resolve`
- `GET/POST /video-editor/media-previews`
- `GET /video-editor/media-previews/[id]`
- `GET/POST /video-editor/proxy-ledger`
- `GET /video-editor/proxy-ledger/[id]`

## Next steps to un-stub this skill

- Document request/response shapes and the auth level (`viewer`/`member`/`admin`/`system`/delegation-only) per route above.
- Add copy-paste-ready example payloads once shapes are confirmed against route source.
- Add an `## Agent patterns` / workflow-guide section once at least one end-to-end flow has been run and verified (write → read-back → report).
- Register any newly-confirmed write-then-verify contract in the pack `verificationContract`.

## Cross-references

- content-engine (short-form video production pipeline)
- youtube-studio-ops (publish rendered video to YouTube)
- creative-canvas-ops (canvas-driven video exports)
