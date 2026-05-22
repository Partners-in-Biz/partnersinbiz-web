# Hermes Agent Skill Policy

Current policy version: `2026-05-22.v1`

The live Partners in Biz task-bus team remains the core five: `pip`, `theo`, `maya`, `sage`, and `nora`. Module agents are reserved, not created in v1: `seo`, `ads`, `docs`, `support`, `data`, and `qa-release`.

## Canonical Manifest

`config/agent-skill-policy.json` is the source of truth for:

- allowed Partners in Biz skills per agent
- allowed global skills per agent
- denied skill names
- profile-specific VPS skill mount directories
- future agent candidates

The manifest is used by:

- `lib/agents/registry.ts` for default advertised skills
- `/api/v1/admin/agents/[agentId]/skill-policy` for preview/apply/drift
- `scripts/apply-agent-skill-policy.mjs` for VPS runtime directories and profile config
- `.github/workflows/sync-vps-skills.yml` for deployment sync
- `services/agent-watcher` docs and startup behavior

## Ownership

`pip` is the front-door operator and orchestrator. Pip owns routing, client context, Projects/Kanban, approvals, status summaries, client onboarding, and cross-agent blocker follow-up.

`theo` is engineering. Theo owns code, infrastructure, deployments, debugging, tests, GitHub/Vercel, and the engineering workflow. Theo is the only core agent with the software-development workflow skills.

`maya` is marketing and creative. Maya owns content-engine, social, brand voice, campaign assets, social scheduling, and client-facing creative packs.

`sage` is research, SEO, and intelligence. Sage owns `research-intelligence`, `seo-sprint-manager`, analytics readouts, competitor research, GSC/PageSpeed/Bing interpretation, and evidence-backed recommendations. SEO remains with Sage in v1.

`nora` is operations. Nora owns billing, CRM hygiene, inbox/email ops, reports, finance-sensitive follow-ups, and administrative reconciliation.

## Runtime Enforcement

Core VPS profiles must set:

```yaml
skills:
  external_dirs:
    - /var/lib/hermes/agent-skills/<agentId>
```

They must not load `/var/lib/hermes/pib-skills` directly. That directory is a shared source cache only.

Apply or refresh policy on the VPS:

```bash
sudo -u hermes bash /var/lib/hermes/partnersinbiz-web/scripts/install-vps-skills.sh --quarantine-profile-skills
```

The apply script:

- links allowlisted PiB skills from `/var/lib/hermes/pib-skills/partnersinbiz`
- links allowlisted global skills from `/var/lib/hermes/hermes-agent/skills`
- updates each profile `config.yaml` external dirs
- can quarantine disallowed local profile skills instead of deleting them

## Theo Delivery Gate

Theo must not jump straight from a large request into implementation. For engineering work that needs planning:

1. Create an online spec/change document.
2. Wait for approval.
3. Create linked Kanban tasks with dependencies and `agentStatus=pending`.
4. Add linkage through `agentInput.context`:
   - `sourceDocumentId`
   - `sourceDocumentSectionId`
   - `sourceSpecVersion`
   - `approvalGateTaskId`
   - `sourceResearchItemId`
5. Implement only after the approval gate is cleared.

## Watcher Behavior

The watcher derives eligible agent IDs from enabled `agent_team` docs at boot. If Firestore is unavailable or returns no usable IDs, it falls back to the core five. Adding a future specialist should not require code edits in the watcher, but still requires:

- an `agent_team/<agentId>` doc
- an `agent_dispatch_configs/<agentId>` doc
- a policy entry in `config/agent-skill-policy.json`
- a rebuilt/restarted watcher
