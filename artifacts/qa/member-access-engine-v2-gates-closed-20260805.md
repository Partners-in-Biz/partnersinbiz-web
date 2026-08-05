# Member-access engine v2 — Gates closed (Theo) — 2026-08-05

Task: ZmP9tn73WGfcak99ws8A (PIB General 0NPzqFGUNVjCNmq03ZR1). Follow-up to Quinn QA BLOCKED verdict RxP6zqj3EDbetQsa0wvS (wiki member-access-engine-v2-qa-2026-08-05.md). Pip requeued after runtime-storm; WIP was committed at 79a696216 (+ runtime fix 413c70ed9). This pack closes the remaining 5 gates.

## Commit

- `e5349bfad74fe9b6d0bdfa0895df09f261d66b2c` — fix(member-access): close Quinn QA gates — typecheck, viewer matrix, acceptance tests
- Pushed to `origin/development` (no `[vercel-build]` marker). Verified: `git status --short --branch` clean, `origin/development` == e5349bfad.

## Files changed (9, +525/-6)

- `lib/companies/types.ts` — add `Company.sharedWithUserIds?: string[]`
- `components/admin-governance/OrganizationModulePolicyControls.tsx` — viewer in ROLE_LABELS + ALL_ROLES
- `lib/orgMembers/access-policy.ts` — FULL_ACCESS_POLICY.moduleActions typed (emptyModuleActions), recordScopes backfill keeps DEFAULT_RECORD_SCOPES, resolveEffectiveMemberPolicy clones modules/recordScopes before applying org defaults
- `__tests__/lib/orgMembers/access-policy.test.ts` — action grants, billing delete fail-closed, org-modulePolicies-as-defaults, explicit-policy precedence, recordScopes backfill, presets, viewer, FULL_ACCESS_POLICY immutability regression
- `__tests__/lib/orgMembers/record-scope.test.ts` (NEW) — research/documents/marketing defaults, explicit scope, admin bypass, actorOwnsRow, filterOwnedRowsForActor incl. CRM-linked rows
- `__tests__/lib/crm/assignment-access.test.ts` — sharedWithUserIds read path, list filtering, patch normalization
- `__tests__/lib/billing/member-issuer.test.ts` — memberCanPerformBillingAction, memberCanDeleteBilling
- `__tests__/lib/organizations/module-policies.test.ts` — viewer matrix, legacy backfill, unknown-role normalization
- `__tests__/components/admin-governance/OrganizationModulePolicyControls.test.tsx` — Viewer toggle in legacy portalModules switch test

## Gates evidence (real output)

1. **Typecheck**: `npm run typecheck` CLEAN (exit 0, no errors). Fixed all 4 Quinn-reported errors.
2. **Stale viewer assertion**: module-policies.test.ts + OrganizationModulePolicyControls.test.tsx updated; both pass.
3. **Acceptance tests**: 5 required groups added (action-level permissions, record scoping beyond CRM/Projects, sharedWithUserIds honored in CRM read path, presets, viewer in role matrix) + org-defaults/precedence/singleton regression.
4. **Affected Jest suites**: `npx jest __tests__/lib/orgMembers __tests__/lib/organizations __tests__/lib/crm __tests__/lib/billing __tests__/lib/companies __tests__/components/admin-governance/OrganizationModulePolicyControls.test.tsx` → **21/21 suites, 148/148 tests PASS** (in 2 projects). Broader check of chat-context/api conversation suites: 52/52 (263 tests). The 4 failing component suites (UnifiedChat.context, LinkedComputersWorkspace, ContextDock, TouchTargetPolicy) were confirmed **pre-existing** — they fail identically on clean development (verified via `git stash`).

## Bonus bugs found + fixed

1. **recordScopes backfill** (`normalizeMemberAccessPolicy`): missing keys were forced to `owned_or_linked`; now keep `DEFAULT_RECORD_SCOPES` (research/documents/marketing = 'all'). This was Quinn's flagged Stean latent bug; back-compat contract preserved.
2. **FULL_ACCESS_POLICY singleton mutation**: `resolveEffectiveMemberPolicy` applied org modulePolicies defaults via shallow spread onto `base` — when `base` was the shared `FULL_ACCESS_POLICY` (member without explicit policy), it mutated the singleton that owners/admins also resolve to. Cross-request contamination. Fixed by cloning `modules`/`recordScopes` before applying; regression test added.

## Scope

Development branch only; no production deploy, no main merge, no secret/config changes, no `[vercel-build]` marker. Tenant-safe fail-closed. Task → `agentStatus: done`, `reviewStatus` left for Quinn re-review.
