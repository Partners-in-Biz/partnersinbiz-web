---
name: creative-canvas-ops
description: >
  Stub skill for the Partners in Biz Creative Canvas module: node graphs, generation runs, provider dispatch, exports to client documents/manuscripts/social drafts, and collaborator presence. Owner: maya. Full request/response docs not yet written. Use this skill whenever the user mentions the Creative Canvas, canvas nodes, canvas runs, or exporting a canvas node to a document/draft.
---

# Creative Canvas Ops — Partners in Biz Platform API (stub)

**Status: stub.** This skill points at a real, shipped API surface under `/api/v1/creative-canvas/*` that has not yet been fully documented (request/response shapes, per-route auth level, and validated agent workflows). Read the route source under `app/api/v1/creative-canvas/**` before relying on undocumented behavior, and do not assume a shape not shown here.

## Owner & scope

- Owner: `maya`
- Scope: Node-graph based creative production surface: canvases, nodes, generation runs (with provider dispatch/retry), exports (client-document draft, manuscript, package, social draft), sharing/presence, source uploads, connections, and templates.
- Base path: `https://partnersinbiz.online/api/v1/creative-canvas`

## Auth (mandatory)

Interactive Hermes runs use the **user-delegation** token injected by Messages / minted via `system-auth` (`Authorization: Bearer pib_dlg_…` + `X-Org-Id`).

- Prefer the injected delegation token for all `/api/v1/*` calls in a human-triggered run.
- `AI_API_KEY` / agent system keys are **cron/system only**.
- Never claim a write succeeded without read-back (see pack `verificationContract` / skill success gate).
- See skill `system-auth` for mint/resolve rules.

## API routes to document next

- `GET/POST /creative-canvas`
- `GET/PATCH /creative-canvas/[id]`
- `GET /creative-canvas/[id]/graph`
- `GET/POST /creative-canvas/[id]/nodes/[nodeId]/output`
- `POST /creative-canvas/[id]/nodes/[nodeId]/review`
- `GET/POST /creative-canvas/[id]/runs`
- `POST /creative-canvas/[id]/runs/generate`
- `POST /creative-canvas/[id]/runs/retry`
- `POST /creative-canvas/[id]/runs/[runId]/complete`
- `POST /creative-canvas/[id]/runs/[runId]/provider-dispatch`
- `GET /creative-canvas/[id]/runs/[runId]/provider-status`
- `POST /creative-canvas/[id]/runs/[runId]/retry`
- `POST /creative-canvas/[id]/exports/draft (client_document/blog_post target — see client-documents `canvas_draft` type)`
- `POST /creative-canvas/[id]/exports/manuscript`
- `POST /creative-canvas/[id]/exports/package`
- `POST /creative-canvas/[id]/exports/social-draft`
- `GET/POST /creative-canvas/[id]/comments`
- `GET/POST /creative-canvas/[id]/versions`
- `POST /creative-canvas/[id]/share`
- `GET/POST /creative-canvas/[id]/presence`
- `POST /creative-canvas/[id]/presence/events`
- `GET/POST /creative-canvas/[id]/orchestration-tasks`
- `GET/POST /creative-canvas/connections`
- `GET/PATCH /creative-canvas/connections/[id]`
- `POST /creative-canvas/connections/[id]/validate`
- `GET /creative-canvas/credits`
- `POST /creative-canvas/import/campaign`
- `GET/POST /creative-canvas/sources`
- `POST /creative-canvas/sources/upload`
- `GET/POST /creative-canvas/templates`
- `POST /creative-canvas/provider-callbacks/higgsfield (provider webhook, not agent-called)`

## Next steps to un-stub this skill

- Document request/response shapes and the auth level (`viewer`/`member`/`admin`/`system`/delegation-only) per route above.
- Add copy-paste-ready example payloads once shapes are confirmed against route source.
- Add an `## Agent patterns` / workflow-guide section once at least one end-to-end flow has been run and verified (write → read-back → report).
- Register any newly-confirmed write-then-verify contract in the pack `verificationContract`.

## Cross-references

- client-documents (`canvas_draft` document type arrives via canvas exports/draft — do not create directly)
- content-engine
- video-editor-ops
- book-studio-ops (open-in-canvas)
- youtube-studio-ops (open-in-canvas)
