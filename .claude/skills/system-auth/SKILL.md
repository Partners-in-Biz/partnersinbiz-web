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

## Interactive auth (target)

```http
POST /api/v1/agent/delegations
Authorization: Bearer <user_session_or_id_token>
Content-Type: application/json

{
  "orgId": "<active org>",
  "purpose": "messages-session",
  "ttlSeconds": 3600
}
```

Response (shape):

```json
{
  "success": true,
  "data": {
    "token": "<delegation_jwt>",
    "expiresAt": "…",
    "actingForUserId": "uid_…",
    "orgIds": ["…"],
    "scopes": ["documents:create", "documents:update", "crm:read", "…"]
  }
}
```

Use on subsequent calls:

```http
Authorization: Bearer <delegation_jwt>
X-Acting-For: <actingForUserId>
X-Org-Id: <orgId>
```

If delegation endpoint is not yet deployed in this environment, fall back to the conversation-provided credential and **still** respect org scoping (`orgId` / `linked.companyId`). Do not invent access to orgs the user cannot open in the portal.

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

Surface the exact API `error` string. Ask the human to grant access or switch org — do not retry with a more privileged key.
