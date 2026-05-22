# Human-Agent Collaboration Platform

This document is the implementation baseline for the internal Partners in Biz agent operating system. The product goal is internal execution quality first: specialised agents, hard approval gates, and complete provenance.

## Operating Model

Pip is the front-door orchestrator. Pip receives ambiguous work, resolves the client/project context, requests specs or documents where needed, and creates linked Kanban work for specialists.

Specialist agents own capability areas rather than generic chat tasks:

- Theo owns engineering implementation and deployment work.
- Maya owns creative and non-spend marketing execution.
- Sage owns research and strategic intelligence.
- Nora owns operations, billing, CRM hygiene, and finance-sensitive admin.
- Ari owns paid ads and spend-sensitive campaign operations.
- Quinn owns QA, release readiness, reviewer queues, and production verification.
- Luca owns support intake, issue reproduction, and routing.
- Vera owns analytics, attribution, dashboards, reporting, and data quality.
- Iris owns specs, client documents, approvals, reports, and deliverable polish.
- Silas owns SEO sprint execution and search-performance interpretation.

## Policy Layers

The platform uses two layers of enforcement:

1. Runtime skill folders decide what an agent can see and load.
2. Server capability checks decide what an agent can do.

`config/agent-skill-policy.json` is the canonical source for both. Every `.claude/skills/**/SKILL.md` path must appear in the catalog with an owner, allowed runtime agents, risk level, and sync target.

## Approval Gates

Approval tasks in Projects/Kanban are the source of truth. Do not create a parallel approval collection in this phase.

Blocked specialist tasks should start as `agentStatus='awaiting-input'` with `approvalGateTaskId`. They are released to `pending` only after the approval task is accepted.

Hard-gated work includes production deploys, paid-ad spend or launch, public publishing, client-visible messages, invoice/payment changes, destructive data operations, secret/config changes, and final client-facing reports.

## Provenance

Meaningful work must link backward to the source request and forward to deliverables. Use the existing task context fields:

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

Expected artifacts should name concrete outputs such as PRs, deployments, smoke-test evidence, reports, campaign records, SEO records, invoice records, or client-visible documents.

## Review Defaults

Quinn is the default reviewer for Theo, Ari, Silas, Vera, and release-sensitive work. Iris reviews document polish and approval readiness. Pip follows up on blocked handoffs and unclear ownership.

## Admin Control Room

The agent board surfaces policy and runtime state: enabled profiles, drift, hard gates, reviewer coverage, capabilities, runtime skill counts, health, profile config, SOUL files, logs, cron jobs, and skill-policy apply actions. Approval queues and workload metrics should continue to use Projects/Kanban as their source as those task-query endpoints mature.
