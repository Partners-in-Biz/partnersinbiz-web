---
name: life-os-ops
description: >
  Stub skill for the Partners in Biz Life OS module: personal check-ins, AI coach sessions, experiments, reminders, and reviews. Owner: pip. Full request/response docs not yet written. Use this skill whenever the user mentions Life OS check-ins, the Life OS coach, personal experiments, reminders, or reviews.
---

# Life OS Ops — Partners in Biz Platform API (stub)

**Status: stub.** This skill points at a real, shipped API surface under `/api/v1/life-os/*` that has not yet been fully documented (request/response shapes, per-route auth level, and validated agent workflows). Read the route source under `app/api/v1/life-os/**` before relying on undocumented behavior, and do not assume a shape not shown here.

## Owner & scope

- Owner: `pip`
- Scope: Peet-facing personal operating system: recurring check-ins, AI coach conversations, self-experiments with tracked outcomes, reminders, and periodic reviews.
- Base path: `https://partnersinbiz.online/api/v1/life-os`

## Auth (mandatory)

Interactive Hermes runs use the **user-delegation** token injected by Messages / minted via `system-auth` (`Authorization: Bearer pib_dlg_…` + `X-Org-Id`).

- Prefer the injected delegation token for all `/api/v1/*` calls in a human-triggered run.
- `AI_API_KEY` / agent system keys are **cron/system only**.
- Never claim a write succeeded without read-back (see pack `verificationContract` / skill success gate).
- See skill `system-auth` for mint/resolve rules.

## API routes to document next

- `GET/POST /life-os/check-ins`
- `GET/POST /life-os/coach`
- `GET/POST /life-os/experiments`
- `GET/POST /life-os/reminders`
- `GET/POST /life-os/reviews`
- `GET/POST /admin/life-os/* (admin-side views — confirm exact routes from route source before use)`

## Next steps to un-stub this skill

- Document request/response shapes and the auth level (`viewer`/`member`/`admin`/`system`/delegation-only) per route above.
- Add copy-paste-ready example payloads once shapes are confirmed against route source.
- Add an `## Agent patterns` / workflow-guide section once at least one end-to-end flow has been run and verified (write → read-back → report).
- Register any newly-confirmed write-then-verify contract in the pack `verificationContract`.

## Cross-references

- project-management (personal task overlap)
- ceo-on-demand-gather (cross-agent status digest)
