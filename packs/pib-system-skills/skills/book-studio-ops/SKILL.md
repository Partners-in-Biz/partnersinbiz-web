---
name: book-studio-ops
description: >
  Stub skill for the Partners in Biz Book Studio module: book projects, chapters, pages, briefs, series, rights ledgers, and publishing packets. Owner: maya. Full request/response docs not yet written. Use this skill whenever the user mentions book studio projects, chapters, manuscript assembly, or publishing packets.
---

# Book Studio Ops — Partners in Biz Platform API (stub)

**Status: stub.** This skill points at a real, shipped API surface under `/api/v1/book-studio/*` that has not yet been fully documented (request/response shapes, per-route auth level, and validated agent workflows). Read the route source under `app/api/v1/book-studio/**` before relying on undocumented behavior, and do not assume a shape not shown here.

## Owner & scope

- Owner: `maya`
- Scope: End-to-end book production: projects, briefs, chapters, pages (including puzzle-page generation), series grouping, rights ledgers, decision logs, analytics imports, artifact links, manuscript assembly, and publishing packet generation.
- Base path: `https://partnersinbiz.online/api/v1/book-studio`

## Auth (mandatory)

Interactive Hermes runs use the **user-delegation** token injected by Messages / minted via `system-auth` (`Authorization: Bearer pib_dlg_…` + `X-Org-Id`).

- Prefer the injected delegation token for all `/api/v1/*` calls in a human-triggered run.
- `AI_API_KEY` / agent system keys are **cron/system only**.
- Never claim a write succeeded without read-back (see pack `verificationContract` / skill success gate).
- See skill `system-auth` for mint/resolve rules.

## API routes to document next

- `GET/POST /book-studio/projects`
- `POST /book-studio/projects/[id]/assemble`
- `POST /book-studio/projects/[id]/open-in-canvas (see creative-canvas-ops)`
- `POST /book-studio/projects/[id]/pages/generate-puzzles`
- `POST /book-studio/projects/[id]/transition`
- `GET/POST /book-studio/briefs`
- `GET/POST /book-studio/chapters`
- `GET/POST /book-studio/pages`
- `GET/POST /book-studio/series`
- `GET/POST /book-studio/rights-ledgers`
- `GET/POST /book-studio/decision-logs`
- `GET/POST /book-studio/analytics-imports`
- `GET/POST /book-studio/artifact-links`
- `GET/POST /book-studio/publishing-packets`
- `GET/POST /book-studio/package-manifests`
- `GET/PATCH /book-studio/[resource]/[id] (generic resource accessor — confirm allowed `resource` values from route source before use)`

## Next steps to un-stub this skill

- Document request/response shapes and the auth level (`viewer`/`member`/`admin`/`system`/delegation-only) per route above.
- Add copy-paste-ready example payloads once shapes are confirmed against route source.
- Add an `## Agent patterns` / workflow-guide section once at least one end-to-end flow has been run and verified (write → read-back → report).
- Register any newly-confirmed write-then-verify contract in the pack `verificationContract`.

## Cross-references

- creative-canvas-ops (open-in-canvas manuscript editing)
- client-documents (manuscript export target)
- content-engine
