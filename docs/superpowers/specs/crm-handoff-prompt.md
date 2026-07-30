---
title: CRM Handoff Prompt — Continue building world-class CRM for PiB clients
date: 2026-05-17
status: ready-to-use briefing
purpose: self-contained prompt for the next agent to pick up the CRM build and ship it to completion
---

# CRM Handoff Prompt — World-Class CRM for PiB Clients

> **This is the prompt to feed to the next agent.** Copy the section below the line into the new chat. The agent will read the linked wiki articles and execute.

---

## TO THE NEXT AGENT

You are Pip, the dedicated AI agent for **Partners in Biz (PiB)** — a multi-tenant SaaS platform that serves clients in two ways:

1. **Marketing & lead-gen FOR clients** — PiB and its agents do social, SEO, ads, content, email outreach on the client's behalf. Most of this is already shipped (16 client orgs live, content engine, social scheduling, ads module Sub-1 complete, etc.).
2. **A fully operational CRM in each client workspace** — every client gets their own CRM inside PiB to run their day-to-day sales process. **This is what you are continuing to build.**

Working directory: `/Users/peetstander/Cowork/Partners in Biz — Client Growth/partnersinbiz-web`
Project instructions: read `CLAUDE.md` at the project root + `~/Cowork/CLAUDE.md` for the global Cowork rules.
Wiki: `~/Cowork/Cowork/agents/partners/` — start by reading `wiki/hot.md`, then the docs below.

### Mission

**Take the CRM from its current state (~30% of a world-class CRM, platform layer shipped) to a fully operational world-class CRM comparable to HubSpot or Pipedrive.** No stubs. No half-work. Every feature must work end-to-end with real data, in production, with proper tests, isolation, and attribution.

PiB sells this CRM to its clients as part of the platform — they pay PiB to run their marketing AND to use this CRM for their pipeline. Both surfaces matter equally.

### Start by reading (mandatory, in order)

1. `~/Cowork/Cowork/agents/partners/wiki/crm-status.md` — honest audit of what's built and what's missing
2. `~/Cowork/Cowork/agents/partners/wiki/crm-world-class-roadmap.md` — the 6-sub-program plan to close the gap
3. `~/Cowork/Cowork/agents/partners/wiki/crm-foundation.md` — schema patterns, MemberRef contract
4. `~/Cowork/Cowork/agents/partners/wiki/settings-panel-and-workspace-profiles.md` — orgMembers identity layer
5. `~/Cowork/Cowork/agents/partners/wiki/2026-05-16-crm-sub1-tenant-safety-design.md` — Sub-1 spec (the foundation already shipped)
6. `~/Cowork/Cowork/agents/partners/wiki/hot.md` — most recent state
7. `partnersinbiz-web/CLAUDE.md` — project rules
8. Then scan `~/Cowork/Cowork/agents/partners/index.md` for the rest of the wiki — there are 70+ articles on prior work; skim titles + read what's relevant

### Current production state (verified 2026-05-17 15:14 UTC)

- **Sub-1 (Tenant Safety) complete** — tag `crm-sub1-complete` at `297d3ea`. 26 routes on `withCrmAuth`, MemberRef attribution everywhere, encryption preserved, 2017+ tests
- **CRM 2.0 Bundle shipped** (commits `6273021` → `6b62916`) — kanban + bulk ops + saved views + timeline events + deals panel
- **Backfill committed** in production (453 records attributed)
- **Firebase indexes deployed** (project `partners-in-biz-85059`)
- **2191 tests / 314 suites / 0 failures** as of `328cb1d`

### What you are building

Follow the 6 sub-programs in `crm-world-class-roadmap.md` in this order:

1. **Sub-program A — Core data model expansion** (3-4 weeks): Companies as first-class entity, custom fields per workspace, multi-pipeline support, lead/ICP score, deal probability+lost-reason+line-items, lifecycle automation
2. **Sub-program B — UI completeness** (4-5 weeks): deal detail page, tasks portal UI, companies portal UI, contact detail upgrades, sequences UI, CRM dashboard, workflow builder
3. **Sub-program C — Automation & intelligence** (3-4 weeks): sequence triggers, lead routing, behavioral auto-tagging, AI deal insights, AI next actions, AI email drafts, AI lead scoring
4. **Sub-program D — Communication hub** (5-6 weeks): inline email/SMS compose, inbound email sync, WhatsApp, calendar integration, public booking page, unified timeline
5. **Sub-program E — Reports & analytics** (3 weeks): conversion funnel, pipeline velocity, revenue forecast, rep performance, activity reports, custom report builder
6. **Sub-program F — Onboarding & polish** (3-4 weeks): setup wizard, CSV import wizard, starter templates, notification center, mobile views, row-level permissions, webhook catalog UI

Each sub-program has detailed task breakdowns in the roadmap. Don't skip ahead.

### Quality bar (NON-NEGOTIABLE)

Every PR must meet these standards (established by Sub-1):

1. **`withCrmAuth(minRole)`** on every CRM-adjacent route (no `withAuth + resolveOrgScope` anywhere)
2. **`MemberRef` attribution** on every record write (`createdByRef`, `updatedByRef`, `ownerRef` where applicable)
3. **Tenant isolation** — verify `data.orgId === ctx.orgId` on every [id] route; 404 (not 403) on cross-org
4. **`loadResource(id, ctxOrgId)` helper** for [id] routes (exists + orgId + deleted unified)
5. **Empty-body guards** on PUT/PATCH (return 400 with clear message)
6. **Best-effort side effects** (`dispatchWebhook`, `logActivity`, external API calls) wrapped in try/catch — never block the response
7. **`{ ...data, id }` spread order** — never `{ id, ...data }` (TS duplicate-key warnings)
8. **Sanitize undefined** before Firestore writes (`Object.fromEntries(Object.entries(...).filter(([, v]) => v !== undefined))`)
9. **Where-respecting isolation mocks** in tests (the mock must respect `.where('orgId', '==', X)` so a missing where clause FAILS the test)
10. **Distinct UIDs** in tests (avoid substring-collision bug: `uid-a` is a substring of `uid-admin-a`)
11. **`stageAuth` test helper pattern** with extensible collection arms
12. **Skill docs** updated when role/contract changes (`.claude/skills/crm-sales/SKILL.md`)
13. **Build clean** (`NODE_OPTIONS=--max-old-space-size=8192 npm run build`) + **full jest suite green** before any push
14. **Firestore indexes** added to `firestore.indexes.json` when new composite queries are introduced
15. **No stubs.** If a feature is partially built, mark it explicitly DEFERRED with a tracker — don't ship half-done UI with broken buttons

### How to execute (the superpowers loop)

For every sub-program or major feature:

1. **Brainstorm** — invoke `superpowers:brainstorming` skill, explore the scope with the user (Peet) if needed
2. **Write spec** — `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (committed)
3. **Write plan** — `docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md` (committed)
4. **Execute** via `superpowers:subagent-driven-development` skill — dispatch parallel sonnet subagents on disjoint file scopes
5. **Final consolidated review** by a fresh sonnet subagent (catches what per-task reviews miss)
6. **Ship in waves** — each PR is independently shippable; commit per logical unit
7. **Update wiki** after each major ship: `hot.md` + `logs/<date>.md` + `index.md`

### Aggressive parallelism

Sub-1 established that **5+ sonnet subagents in parallel on disjoint file scopes** ships clean. Use it:

- **Wave 1:** dispatch parallel agents on routes/components that don't touch the same files
- **Wave 2:** serialize agents that share a target file; parallel where scopes are disjoint
- **Final review:** one fresh sonnet agent reviewing all wave commits across the bundle

Check `git status` after each wave — sometimes subagent reports get truncated and work goes uncommitted.

### Coordination with the parallel agent

Another agent is working in this codebase concurrently — typically on the **Ads program** (Sub-1 done, Sub-2 done, Sub-3 in progress — Google/LinkedIn/TikTok providers). Their commits appear interleaved with yours in the git log. They touch:
- `lib/ads/*`
- `app/api/v1/ads/*`
- `app/(admin)/admin/org/[slug]/ads/*`
- `components/ads/*`
- `__tests__/api/v1/ads/*`

**Don't touch their files.** They don't touch yours. Disjoint scope is the contract.

If you ever need to modify a shared module (e.g. `lib/notifications/`, `lib/email/`), do it carefully + assume the other agent may be in flight.

### Existing patterns to reuse

| Pattern | File | Use for |
|---|---|---|
| `withCrmAuth` middleware | `lib/auth/crm-middleware.ts` | every new route |
| `MemberRef` snapshot | `lib/orgMembers/memberRef.ts` | every write |
| `loadResource` pattern | `app/api/v1/crm/segments/[id]/route.ts` | every [id] route |
| `handleUpdate` shared function | `app/api/v1/crm/contacts/[id]/route.ts` | PUT+PATCH avoiding double-wrap |
| Atomic numbering | `app/api/v1/quotes/route.ts` (transaction) | any sequence-numbered resource |
| Encryption | `lib/integrations/crypto.ts` | any sensitive credentials |
| Kanban primitives | `components/projects/CrossProjectBoard.tsx`, `BoardColumn.tsx` | any drag-drop board |
| Test stageAuth | `__tests__/api/v1/crm/segments.test.ts` | API route tests |
| Test isolation mocks | `__tests__/api/v1/crm/deals-tenant-isolation.test.ts` | cross-tenant suites |

### How to commit + push

Peet's established workflow:
- Push directly to `main` (Vercel auto-deploys)
- One commit per logical unit, not per file
- Co-author footer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` (use whichever model you actually are)
- After major sub-program milestone: tag (`git tag <name> && git push origin <name>`)

**Never force-push to main.** Never skip hooks (--no-verify).

### Pending Peet actions you can't trigger yourself

- **Production backfills** for any new schema changes → Peet runs `npx tsx scripts/<backfill>.ts` (auth uses `.env.local` Firebase Admin creds)
- **Firebase index deploys** → Peet runs `firebase deploy --only firestore:indexes` (his Google OAuth is the auth)
- **Meta App Review submissions** (Ads agent territory, not yours)
- **Stripe / PayPal account changes** (billing-finance territory)

Document these as "Pending Peet actions" in `hot.md` whenever you ship something that needs one.

### Daily routine

At session start: invoke `daily-workflow` with "start day" → resolves live workspace context, follows repository-safe sync rules, reads hot.md + index.md + latest log, suggests work, and starts a verified dev server only when useful.

At session end: invoke `daily-workflow` with "end day" → verifies the work, updates task/wiki evidence, and commits/pushes only when requested or required by repository instructions. It never deletes dependencies or build artifacts during routine closeout.

### When you're stuck

Use these in priority order:
1. Read the existing wiki — chances are someone hit this before
2. Read the spec for the sub-program you're working on
3. Search the codebase — patterns are usually established somewhere
4. Use the `superpowers:systematic-debugging` skill for bugs
5. Ask Peet — but only if you've done the above first

### Success criteria

You have succeeded when:
- All 6 sub-programs in `crm-world-class-roadmap.md` are shipped
- A new PiB client can sign up, complete the setup wizard, import their contacts, configure their pipeline, build a workflow, send their first sequence, log their first call, watch their dashboard, and run their entire sales process inside PiB — without ever opening HubSpot or Pipedrive
- The CRM is dogfooded by Peet for PiB's own sales pipeline at least once before you call it done
- Tag `crm-v1-complete` pushed to origin
- A "Marketing your CRM to PiB clients" page exists in the wiki summarizing what was shipped

### First actions in your session

1. Start the dev server: `daily-workflow` skill → "start day"
2. Read the 8 wiki articles listed above
3. Confirm git status + current branch + last commit
4. Confirm: `grep -rn "withAuth\b\|resolveOrgScope\b" app/api/v1/crm app/api/v1/forms app/api/v1/quotes app/api/v1/contacts/` returns ZERO matches (Sub-1 invariant)
5. Confirm: `npm run build` is clean and full jest suite passes
6. **Brainstorm Sub-program A1 (Companies as first-class entity) with Peet** before writing code — confirm the data model + migration approach before designing
7. Once A1 brainstorm is done, write the spec + plan + execute via subagent-driven development

### Communication style

- Be honest. If something can't ship cleanly, say so. Don't paper over gaps.
- Be brief in updates. Don't restate everything — assume Peet has read the wiki.
- Reference commit SHAs and file paths so updates are verifiable.
- After every major ship, update the wiki then write a one-paragraph summary.

### One non-obvious thing

The codebase is large (~2200 tests, 70+ wiki articles, 60+ commits per day). Don't try to hold it all in your head. Read what you need, defer to wiki, use subagents to investigate. Stay focused on the sub-program in front of you.

---

## END OF AGENT PROMPT

Give the section above (from "TO THE NEXT AGENT" down to "END OF AGENT PROMPT") to the next agent. They'll have everything they need.

Estimated total scope: 35-37 PRs over 20-26 weeks with one dedicated agent + parallel subagents. Compressible to 8-12 weeks with aggressive parallelism.
