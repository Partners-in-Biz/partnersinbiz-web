---
name: pib-agent-org-setup
description: Use when Peet describes an org agent structure and Pip must seed the chart, bind seats, and provision Hermes profiles on machines.
version: 1.0.0
author: pip
license: internal
metadata:
  hermes:
    tags: [partnersinbiz, agents, org-chart, setup, provision, multi-org, hermes-profiles]
    related_skills:
      - pib-agent-org-operations
      - agent-runtime-ops
      - agent-skill-drift-gather
      - pib-system-skill-authoring
      - project-management
---

# PiB agent org setup (explain structure → chart + machines)

## When to use

- Peet wants an **organisation-level** agent company (not only platform admin)
- “Build this org’s agents”, “Theo FE/BE as real agents”, “seed client org chart”
- Natural-language brief: hierarchy, roles, skills, models → **Firestore org chart + live Hermes profiles**
- Multi-org: each client org can have a different tree and different bound agentIds

## Non-goals

- Not an auto-router that invents work without Kanban assignment
- Chart edits alone do **not** create machine profiles
- Portal org-admins edit **chart seats**; only Pip/Theo with runtime access provision profiles
- Do not push secrets/config or production deploys without Peet approval

## Two layers (always separate)

| Layer | Where | Live work? |
|---|---|---|
| Org chart seats | Firestore `agent_org_nodes` per `orgId` | No — titles, reportsTo, defaults, bind agentId |
| Runtime agents | Hermes profiles on Mac/VPS (`pip`, `theo`, `theo-fe`…) | Yes — skills, model, tools, linked devices |

Binding `agentId` on a seat points dispatch at a real profile. Unbound seat = organisational only.

## Surfaces

| Surface | URL / API | Who |
|---|---|---|
| Platform admin chart | `/admin/agents/org-chart` + `/api/v1/admin/agent-org/**` | Super/admin, org switcher |
| Portal org chart | `/portal/settings/agents/org-chart` + `/api/v1/portal/settings/agents/org-chart/**` | Org owner/admin; **active org auto-selected** |
| Live agents | `/admin/agents` or portal Agents | Machine registry / org agent packs |
| Task bus | Projects/Kanban | Real assignment + watcher dispatch |

Portal seed defaults: `platform` template for `pib-platform-owner`, `minimal` for client orgs. Idempotent if nodes exist.

## Operator brief Peet should give Pip

Collect before acting:

1. `orgId` (never guess client org)
2. Hierarchy: root + reportsTo edges
3. Per seat: name, title, capabilities, defaultModel/effort
4. Bind vs hire: reuse `theo` vs create `theo-fe` / `theo-be`
5. Target machines: Mac mini linked-device id and/or VPS fleet
6. Skill packs per profile (policy allowlist)
7. Whether to seed empty chart first

## Procedure

### A) Chart only (fast)

1. Resolve orgId; confirm active org if portal.
2. `GET` chart:
   - Admin: `GET /api/v1/admin/agent-org?orgId=…`
   - Portal: `GET /api/v1/portal/settings/agents/org-chart`
3. If empty and Peet wants starter: `POST …/seed` with `{ template: "platform"|"minimal" }` (admin body includes `orgId`).
4. Create/patch nodes (name, title, reportsTo, capabilities, defaults, agentId bind).
5. Verify tree has one logical root and no cycles.

### B) Make seats live (hire profiles)

For each seat that must run work:

1. Choose unique `agentId` (Hermes profile name), e.g. `theo-fe`.
2. Provision profile on target machine(s) via `agent-runtime-ops` (registry + profile link + skills apply). Do not invent sidecar URLs.
3. Confirm profile appears on linked computers / agent health.
4. PATCH org node `agentId` to that profile id.
5. Optional admin-only: push model/effort to live `config.yaml` (Org role “Push to live Hermes” or runtime-model PUT). Portal chart does **not** rewrite machines by default.

### C) Multi-org pattern

- Repeat A/B per orgId. Charts never share nodes across orgs.
- Client orgs usually start with **minimal** unbound seats, then bind shared specialists or hire dedicated profiles.
- Shared fleet: multiple org seats may bind the same live `agentId` (same brain, different governance). Dedicated brains need separate profiles.

### D) Delegation behaviour Peet expects

“Theo knows the task and sends to the right specialist” today means:

1. Work lands on Kanban with `assigneeAgentId` (human, Pip, or lead).
2. Lead (e.g. theo) **creates child tasks** assigned to bound specialists when relationship rules allow.
3. Org chart gates agent→agent assign and fills default model/effort when blank.
4. It does **not** auto-pick a specialist from skills without an assign step.

If Peet wants automatic skill-based routing, that is a **future** router on top of this chart — out of scope for this setup skill unless explicitly specified and approved.

## API cheat sheet

Admin (carry `orgId`):

- `GET/POST /api/v1/admin/agent-org`
- `PATCH/DELETE /api/v1/admin/agent-org/:nodeId`
- `POST /api/v1/admin/agent-org/seed` body `{ orgId, template? }`

Portal (active org from session):

- `GET/POST /api/v1/portal/settings/agents/org-chart`
- `PATCH/DELETE /api/v1/portal/settings/agents/org-chart/:nodeId`
- `POST /api/v1/portal/settings/agents/org-chart/seed` body `{ template? }`

Auth: user-delegation Bearer + `X-Org-Id` for the target org. Portal routes use portal session + owner/admin role.

## Verification

1. Chart GET returns expected nodes/tree for that orgId only.
2. Unbound seats: agentId null; bound seats match real profile ids.
3. Kanban task to bound agentId dispatches to linked runtime (watcher / hermes_runs).
4. Client org chart empty ≠ platform chart; seed minimal does not copy platform roster.
5. After profile hire: `agent-runtime-ops` health + skill-policy drift check if skills changed.
6. Wiki: short note under `agents/partners/wiki/` when a durable multi-org pattern is established.

## Pitfalls

- Binding FE/BE both to `theo` is fine for hierarchy/defaults but is **one** brain.
- Creating chart seats without profiles looks “live” in UI titles only — cyan chips need real runtime.
- Do not run normal app work on `main`; chart/UI code ships on `development` then scoped promote when Peet asks.
- Never claim portal chart save syncs all org machines — only explicit runtime push/provision does.
- Always resolve client orgId before client chart mutations.

## Related

- `pib-agent-org-operations` — day-to-day chart ops, permissions, task hooks, dual SoT
- `agent-runtime-ops` — provision/link Hermes profiles, skills apply, health
- `agent-skill-drift-gather` — after policy/profile changes
- `pib-system-skill-authoring` — landing this skill in policy packs
