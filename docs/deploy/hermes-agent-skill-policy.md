# Hermes Agent Skill Policy

Current policy version: `2026-05-22.v2`
Catalog version: `2026-05-22.skills-v2`

Partners in Biz now treats every agent skill as a cataloged, owned, versioned runtime capability. The platform team is 11 specialists:

| agentId | UI name | Ownership |
| --- | --- | --- |
| `pip` | Pip | Routing, client context, Projects/Kanban, approvals, status summaries, onboarding, cross-agent blockers |
| `theo` | Theo | Engineering, infra, deployments, debugging, tests, GitHub/Vercel, engineering workflows |
| `maya` | Maya | Creative, content-engine, social, brand voice, campaign assets, non-spend publishing work |
| `sage` | Sage | Research, strategic intelligence, competitor analysis, evidence-backed recommendations |
| `nora` | Nora | Billing, CRM hygiene, inbox/email ops, finance-sensitive admin and reconciliation |
| `ads` | Ari | Paid ads, ad audits, media plans, budgets, experiments, launch/spend workflows |
| `qa-release` | Quinn | QA, release readiness, smoke tests, production verification, reviewer queue |
| `support` | Luca | Ticket intake, issue reproduction, support triage, client issue routing |
| `data` | Vera | Analytics, dashboards, attribution, reporting, data quality |
| `docs` | Iris | Client documents, specs, approvals, reports, deliverable polish |
| `seo` | Silas | SEO sprint execution, local SEO, GSC/PageSpeed/Bing interpretation |

## Canonical Manifest

`config/agent-skill-policy.json` is the source of truth for:

- every discovered repo skill path under `.claude/skills/**/SKILL.md`
- each skill's owner agent, allowed runtime agents, risk level, and sync target
- allowed global skills per agent
- runtime profile directories
- capability policy: `read`, `draft`, `write`, `approve`, `publish`, `deploy`, `spend`, `message_client`, `access_secret`, and `delete`
- hard approval gates
- reviewer defaults and cross-agent request boundaries

The manifest is consumed by:

- `lib/agents/registry.ts` for advertised skills and default metadata
- `/api/v1/admin/agents/[agentId]/skill-policy` for preview/apply/drift
- `scripts/apply-agent-skill-policy.mjs` for generated VPS runtime folders and profile config
- `.github/workflows/sync-vps-skills.yml` and `scripts/install-vps-skills.sh` for skill sync
- `scripts/seed-agent-team.ts` and `scripts/seed-agent-dispatch-configs.ts` for specialist bootstrap metadata
- `services/agent-watcher` for the enabled-agent dispatch model

## Runtime Enforcement

Each Hermes profile must load one generated directory:

```yaml
skills:
  external_dirs:
    - /var/lib/hermes/agent-skills/<agentId>
```

Profiles must not load `/var/lib/hermes/pib-skills` directly. That directory is the shared source cache only.

Apply or refresh policy on the VPS:

```bash
sudo -u hermes bash /var/lib/hermes/partnersinbiz-web/scripts/install-vps-skills.sh --quarantine-profile-skills
```

The apply script:

- derives repo skill sync from the v2 catalog, including nested `marketing/*` and `software-development/*` skills
- resets each generated `/var/lib/hermes/agent-skills/<agentId>/partnersinbiz` directory before linking, so stale repo skills cannot remain visible
- links allowlisted global skills from `/var/lib/hermes/hermes-agent/skills`
- updates each profile `config.yaml` external dirs
- can quarantine disallowed local profile skills instead of deleting them

## Capability Gates

Server-side action checks must call `assertAgentCapability(agentId, capability, context)` before sensitive work. A capability being listed on an agent means the agent can request or perform that class of work; if the capability is also in the agent's `approvalGates`, the action still requires an approved Project/Kanban approval task.

Hard gates cover:

- production deploys and release promotion
- paid-ad spend, launch, or budget changes
- public publishing
- client-visible email or message sends
- invoice/payment changes
- destructive data operations
- secret/config changes
- final client-facing reports

The shared `AI_API_KEY` is a migration/admin fallback only. Per-agent keys in `api_keys` are hashed, resolve to `uid=agent:<agentId>`, and carry permissions into route handlers.

## Work Provenance

Tasks should preserve source and output traceability through existing task context fields:

- `riskLevel`
- `requiredCapability`
- `requestedByAgentId`
- `reviewerAgentId`
- `approvalGateTaskId`
- `sourceDocumentId`
- `sourceDocumentSectionId`
- `sourceSpecVersion`
- `sourceResearchItemId`
- `expectedArtifacts`

Every meaningful output should link backward to its source spec, document, research item, or approval gate and forward to concrete artifacts such as PRs, deployment URLs, reports, campaign records, SEO records, invoices, or client-visible deliverables.

## Delivery Rules

Pip remains the front-door orchestrator. For substantial work, Pip should request or create a spec through Iris, then create dependent specialist tasks.

Theo implementation requires an approved spec and Quinn review before release-sensitive work is marked ready.

Ari may draft and audit ad work without spend approval, but launch/spend/budget changes require an approval task.

Silas and Maya can draft optimization and content work, but public publishing requires the relevant approval gate.

Quinn is the default reviewer for Theo, Ari, Silas, Vera, and release-sensitive work.

## Watcher Behavior

The watcher derives eligible agents from enabled `agent_team` docs. If Firestore is unavailable or returns no usable IDs, it falls back to the 11 policy agents.

Every dispatch should include provenance and review context where available: source document, approval gate, risk level, required capability, expected artifacts, and reviewer agent. The watcher must not dispatch tasks blocked by dependencies or pending approval gates.
