# Partners in Biz Web Agent Rules

This repository powers the live Partners in Biz production site.

## Branch Policy

- `main` is production-only.
- `development` is the normal working branch for feature, bugfix, and agent work.
- Do not edit, commit, or push normal work on `main`.
- Do not run `vercel --prod`, promote a Preview deployment, or merge to `main` unless Peet explicitly asks for a production release.

## Required Preflight

Before editing this repo, sync first. This is not a blocker gate; it is the routine for preserving any local work and getting onto latest `development`.

```bash
git status --short --branch
# If local changes already exist, checkpoint them before pulling:
git add -A
git commit -m "chore(agent): checkpoint existing local work before sync"
git pull --rebase origin development
git status --short --branch
```

After the sync, the branch must be `development`. If the repo is on `main`, switch to `development` before editing. If `development` is missing, stop and report that hard blocker.

A dirty `development` worktree is expected because multiple agents may work in the same checkout. Dirty or untracked files do not block new work, and "local changes would be overwritten by pull" is not an acceptable reason to stop. Checkpoint-commit existing local work, rebase onto latest `origin/development`, then continue.

Resolve rebase conflicts when they are in files related to the checkpointed work or the task. Only stop for true hard blockers such as missing credentials, a conflict that cannot be resolved safely from the available context, or a broken branch Git cannot rebase. Do not force-pull, reset, stash, checkout over work, or discard another agent's/user's changes unless Peet explicitly asks for that destructive recovery.

## Commit and Push Discipline

Agents must leave completed work committed and pushed to `origin/development`. If tests/builds are relevant, run them before committing. If push is blocked by credentials, network, divergence, or CI/pre-push failures, report the blocker and leave the local commit in place.

## Deployments

Push normal work to `origin/development`. Vercel should build those pushes as Preview deployments for development/testing. The public production site remains tied to `main`.

## Hermes Agent Skill Policy

The live PiB task-bus specialists are `pip`, `theo`, `maya`, `sage`, `nora`, `ads`, `qa-release`, `support`, `data`, `docs`, and `seo`. UI names may be human-friendly, but routing and policy always use the functional `agentId`.

Runtime skills are hard-allowlisted by `config/agent-skill-policy.json`. The v2 manifest catalogs every repo skill path, declares an owner, risk level, runtime agents, sync target, action capabilities, approval gates, and reviewer defaults. The same manifest is consumed by the app registry, admin skill-policy view, VPS sync/apply scripts, and watcher rollout notes.

- `pip` owns routing, client context, Projects/Kanban, approvals, status summaries, onboarding, and cross-agent follow-up.
- `theo` owns engineering, infra, deployments, debugging, tests, GitHub/Vercel, and the engineering workflow skills.
- `maya` owns content-engine, social, brand voice, campaign assets, scheduling, and creative packs.
- `sage` owns research, strategic intelligence, competitor analysis, and evidence-backed recommendations.
- `nora` owns billing, CRM hygiene, inbox/email ops, reports, finance-sensitive follow-ups, and admin reconciliation.
- `ads` / Ari owns paid ads, ad audits, media planning, budgets, experiments, and launch/spend workflows.
- `qa-release` / Quinn owns QA, release readiness, smoke tests, reviewer queues, and production verification.
- `support` / Luca owns ticket intake, issue reproduction, triage, and client support routing.
- `data` / Vera owns analytics, dashboards, attribution, reporting, and data quality.
- `docs` / Iris owns client documents, specs, approvals, reports, and deliverable polish.
- `seo` / Silas owns SEO sprint execution, local SEO, GSC/PageSpeed/Bing interpretation, and optimization queues.

Sensitive capabilities are hard gates, not suggestions. Production deploys, paid-ad spend or launch, public publishing, client-visible email/message sends, invoice/payment changes, destructive data operations, secret/config changes, and final client reports require an approval task in Projects/Kanban before execution.

Theo’s engineering workflow must use the Partners delivery gate: create the online spec/change document first, wait for approval, then create linked Kanban implementation tasks with dependencies and `agentStatus=pending`. Link tasks back through `agentInput.context.sourceDocumentId`, `sourceDocumentSectionId`, `sourceSpecVersion`, `approvalGateTaskId`, `sourceResearchItemId`, `riskLevel`, `requiredCapability`, `reviewerAgentId`, and `expectedArtifacts` where applicable.

VPS profiles must load only `/var/lib/hermes/agent-skills/<agentId>` in `skills.external_dirs`. Do not point core specialist profiles back at `/var/lib/hermes/pib-skills`; that shared cache is only the source for policy-generated per-agent directories.
