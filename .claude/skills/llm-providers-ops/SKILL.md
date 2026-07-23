---
name: llm-providers-ops
description: >
  Stub skill for the Partners in Biz LLM provider connections module: bring-your-own-provider credential connections and OAuth linking for agent/runtime model access. Owner: theo. Full request/response docs not yet written. Use this skill whenever the user mentions connecting an LLM provider, provider OAuth, or per-org/per-agent model provider credentials.
---

# LLM Providers Ops — Partners in Biz Platform API (stub)

**Status: stub.** This skill points at a real, shipped API surface under `/api/v1/llm-providers/*` that has not yet been fully documented (request/response shapes, per-route auth level, and validated agent workflows). Read the route source under `app/api/v1/llm-providers/**` before relying on undocumented behavior, and do not assume a shape not shown here.

## Owner & scope

- Owner: `theo`
- Scope: Provider connection management for LLM access: creating/listing/updating provider connections and running the OAuth linking flow for providers that require it.
- Base path: `https://partnersinbiz.online/api/v1/llm-providers`

## Auth (mandatory)

Interactive Hermes runs use the **user-delegation** token injected by Messages / minted via `system-auth` (`Authorization: Bearer pib_dlg_…` + `X-Org-Id`).

- Prefer the injected delegation token for all `/api/v1/*` calls in a human-triggered run.
- `AI_API_KEY` / agent system keys are **cron/system only**.
- Never claim a write succeeded without read-back (see pack `verificationContract` / skill success gate).
- See skill `system-auth` for mint/resolve rules.

## API routes to document next

- `GET/POST /llm-providers/connections`
- `GET/PATCH/DELETE /llm-providers/connections/[id]`
- `POST /llm-providers/oauth/start`
- `GET /llm-providers/oauth/[sessionId]`

## Next steps to un-stub this skill

- Document request/response shapes and the auth level (`viewer`/`member`/`admin`/`system`/delegation-only) per route above.
- Add copy-paste-ready example payloads once shapes are confirmed against route source.
- Add an `## Agent patterns` / workflow-guide section once at least one end-to-end flow has been run and verified (write → read-back → report).
- Register any newly-confirmed write-then-verify contract in the pack `verificationContract`.

## Cross-references

- system-auth (token/credential minting doctrine)
- platform-ops (API key management surface)
