---
name: system-auth
description: >
  Authenticate Partners in Biz API calls correctly. Interactive agent work must use a
  user-delegation token scoped to the requesting human's org/module access. Platform
  AI_API_KEY / long-lived agent keys are for cron and system jobs only. Use whenever an
  agent is about to call /api/v1/*, create documents, invoices, CRM records, or publish.
---

# System Auth — Partners in Biz

## Rules (non-negotiable)

1. **Interactive chat / Messages / Cowork agent runs** acting for a human → use a **user-delegation token**.
2. **Cron, watchers, system maintenance** → platform `AI_API_KEY` or per-agent system key is allowed.
3. Skills describe *how* to call the API. The API enforces *whether*. Never assume a god-key bypasses org ACLs.
4. Effective permission = `user scopes ∩ agent capability ∩ approval gates`.

## Interactive auth (implemented route)

```http
POST /api/v1/agent/delegations
Authorization: Bearer <user_session_or_id_token>
Content-Type: application/json

{
  "orgId": "<active org>",
  "agentId": "pip",
  "purpose": "messages:conv_123",
  "ttlSeconds": 3600,
  "conversationId": "conv_123"
}
```

Response (shape):

```json
{
  "success": true,
  "data": {
    "id": "dlg_123",
    "token": "pib_dlg_…",
    "expiresAt": "…",
    "actingForUserId": "uid_…",
    "agentId": "pip",
    "orgIds": ["…"],
    "scopes": ["documents:create", "documents:update", "crm:read", "…"]
  }
}
```

Use on subsequent calls:

```http
Authorization: Bearer <pib_dlg_…>
X-Org-Id: <orgId>
```

### Messages dispatch (automatic)

When a human sends a Messages chat that dispatches Hermes / linked-computer runs, the platform mints a **fresh** short-lived delegation on **every turn** (never reuse a stale `pib_dlg_` from an earlier turn or a cached conversation blob) and injects:

```
[Partners in Biz API auth — user delegation]
Authorization: Bearer pib_dlg_…
X-Org-Id: <orgId>
```

into the agent prompt. Prefer that injected Bearer token for all `/api/v1/*` calls in the run. Do not fall back to `AI_API_KEY`.

If `/api/v1/agent/email/*` (or another mailbox route that requires delegation evidence) returns 401/403, the platform remints a fresh user-delegation token **once in the same run** and retries silently. Do not ask the human to send a chat message. If the mailbox call still fails, say the mailbox call failed and stop.

**Rollout:** mint + Bearer resolution + Messages prompt injection are in `partnersinbiz-web` app code. Live after the app deployment that includes this change.

## System auth (cron only)

```http
Authorization: Bearer <AI_API_KEY_or_agent_key>
```

Tag writes with `createdByType: "system"` when the job is cron-originated.

## Forbidden

- Using the platform god-key in an interactive session “because it is easier”
- Creating resources in an org the requesting user cannot access
- Claiming success after a write without read-back verification (see pack `verificationContract`)

## When access is denied

Surface the exact API `error` string. Ask the human to grant access or switch org — do not retry with a more privileged key. Never instruct a chat remint ritual.
