# User-delegation auth (spec)

Status: **spec for implementation** (pack v0.1.0)  
Owner: Theo + Pip  
Related skill: `skills/system-auth`

## Goal

Interactive agents may only perform actions the **requesting human** could perform in the portal for the selected org(s).

## Model

```
effective = userModulePolicy(org) ∩ agentCapabilities(agentId) ∩ approvalGates
```

| Actor | Credential |
| --- | --- |
| Human in Messages / Cowork | Session → mint `delegation` token |
| Hermes agent in that session | Uses delegation token on `/api/v1/*` |
| Cron / watcher | `AI_API_KEY` or per-agent system key; `createdByType=system` |

## API

### `POST /api/v1/agent/delegations`

Auth: Firebase session / ID token of the human.

Body:

```json
{
  "orgId": "AEsehyRzcy2wfk0aR7KY",
  "purpose": "messages:<conversationId>",
  "ttlSeconds": 3600,
  "agentId": "pip"
}
```

Behaviour:

1. Resolve caller user + org membership / platform admin allowlist.
2. Load org module policy actions the user may perform.
3. Intersect with agent’s allowlisted capabilities from skill policy.
4. Issue signed JWT (or opaque token stored in Firestore) with claims:
   - `actingForUserId`
   - `agentId`
   - `orgIds`
   - `scopes[]`
   - `exp`
5. Return token + scopes + expiry.

### Request auth resolution order (platform)

1. Delegation token → user-scoped
2. Per-agent API key → agent identity; **reject** for interactive routes once migration flag is on
3. Legacy `AI_API_KEY` → system only when `X-PiB-System-Job: 1` or cron path allowlist

### Enforcement

Every mutating route already has org checks; additionally:

- Require scope for the module action (e.g. `documents:create`)
- Stamp `actingForUserId` / `actingForUserType` on writes
- Audit log includes both agent and human

## Migration

1. Ship endpoint behind flag `AGENT_DELEGATION_REQUIRED=false`
2. Messages runtime mints delegation and attaches to tool calls
3. Flip flag per environment: preview → development → production
4. Skills pack `system-auth` becomes mandatory reading for all agents

## Non-goals (v1)

- End-user OAuth for external client employees beyond existing portal auth
- Fine-grained field-level ACLs inside a document
