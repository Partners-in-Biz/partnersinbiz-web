---
name: conversations-runtime
description: >
  Stub skill for the Partners in Biz conversations/chat runtime: conversation lifecycle, message streaming lifecycle (stop/finalize), attachments, model selection, and agent-message ingestion. Owner: theo. Full request/response docs not yet written. Use this skill whenever the user is debugging or building against the conversations/chat message API, not when drafting user-facing chat content (see chat-surface-gather for the read-only surface digest).
---

# Conversations Runtime — Partners in Biz Platform API (stub)

**Status: stub.** This skill points at a real, shipped API surface under `/api/v1/conversations/*` that has not yet been fully documented (request/response shapes, per-route auth level, and validated agent workflows). Read the route source under `app/api/v1/conversations/**` before relying on undocumented behavior, and do not assume a shape not shown here.

## Owner & scope

- Owner: `theo`
- Scope: Engineering-facing conversation runtime: conversation CRUD, message send/continue/stop/finalize lifecycle, attachments, per-conversation model selection, per-conversation context assembly, and agent-message ingestion used by dispatch/watcher code paths.
- Base path: `https://partnersinbiz.online/api/v1/conversations`

## Auth (mandatory)

Interactive Hermes runs use the **user-delegation** token injected by Messages / minted via `system-auth` (`Authorization: Bearer pib_dlg_…` + `X-Org-Id`).

- Prefer the injected delegation token for all `/api/v1/*` calls in a human-triggered run.
- `AI_API_KEY` / agent system keys are **cron/system only**.
- Never claim a write succeeded without read-back (see pack `verificationContract` / skill success gate).
- See skill `system-auth` for mint/resolve rules.

## API routes to document next

- `GET/POST /conversations`
- `GET/PATCH /conversations/[convId]`
- `GET/POST /conversations/[convId]/messages`
- `POST /conversations/[convId]/messages/[msgId]/stop`
- `POST /conversations/[convId]/messages/[msgId]/finalize`
- `POST /conversations/[convId]/continue`
- `GET/POST /conversations/[convId]/agent-messages`
- `GET/POST /conversations/[convId]/attachments`
- `GET/DELETE /conversations/[convId]/attachments/[attachmentId]`
- `GET /conversations/[convId]/context`
- `GET/POST /conversations/[convId]/models`

## Next steps to un-stub this skill

- Document request/response shapes and the auth level (`viewer`/`member`/`admin`/`system`/delegation-only) per route above.
- Add copy-paste-ready example payloads once shapes are confirmed against route source.
- Add an `## Agent patterns` / workflow-guide section once at least one end-to-end flow has been run and verified (write → read-back → report).
- Register any newly-confirmed write-then-verify contract in the pack `verificationContract`.

## Cross-references

- chat-surface-gather (read-only chat-surface digest for non-engineering agents)
- system-auth (delegation token minting used by interactive conversation runs)
