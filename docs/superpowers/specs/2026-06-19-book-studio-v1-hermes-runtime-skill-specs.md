# Book Studio V1 Hermes Runtime Skill Specs, Fixtures, Evaluation Reports, And Dispatch Guards

Date: 2026-06-19
Status: Phase 1 implementation artifact; runtime dispatch remains disabled.
Project: Book Studio Still Needed — V1 Readiness Sprint (`5GDIUtHdAlt6KNfZpoXt`)
Task: Pip Hermes specs (`rZZb7NnMRpmri6HcteqR`)
Source requirements ledger: `bZz8IZV3kkv4LNHkllny`
Approved Phase 1 plan: `j7IqktQ5N5JcinaSPXso`
Bridge-flow source: `bu29pUr3oGHEF1N4NOLA`

## Purpose

This document captures the Hermes-side Book Studio V1 contract now represented in code at `lib/book-studio/hermes.ts` and covered by `__tests__/api/book-studio-data-api.test.ts`.

It prepares skill specs, safe fixtures, sanitizer expectations, evaluation report shape, and no-runtime-dispatch guards without enabling Hermes runtime execution.

## V1 posture

Book Studio V1 can draft, analyse, summarize, warn, block, and recommend internal reviewer tasks. It cannot publish, upload, spend, message clients, connect or store credentials, approve release states, mutate marketplace metadata, scrape keywords/categories, or trigger live Hermes skill dispatch from Book Studio records.

Every Hermes-side skill spec is represented with:

- `skillKey`
- `ownerAgent`
- `requiredInputs`
- `sourceKeys`
- `artifactType`
- `allowedOutputs`
- `forbiddenOutputs`
- `reviewerDefault`
- `visibility`
- `sanitizerExpectation`
- `fixtureIds`
- `runtimeDispatchAllowed: false`
- `canTriggerPublishing: false`

## Prepared skill specs

The implementation now provides spec records for:

- `book-niche-research`
- `book-series-strategy`
- `book-brief-builder`
- `book-outline-builder`
- `book-generation-safety-review`
- `book-metadata-optimizer`
- `book-kdp-readiness-check`
- `book-google-play-readiness-check`
- `book-publishing-account-readiness`
- `book-analytics-import`

These are internal contract specs, not runnable Hermes skills.

## Fixture pattern

The runtime fixture catalog uses the existing approval packet IDs and covers pass, warn, block, and forbidden-action cases. Core fixtures include:

- `HERMES-BNF-PASS-001`
- `HERMES-LOW-WARN-001`
- `HERMES-SERIES-PASS-001`
- `HERMES-RIGHTS-BLOCK-001`
- `HERMES-SOURCE-WARN-001`
- `HERMES-FORBID-001`
- `HERMES-FORBID-PUBLISH-001`
- `HERMES-FORBID-CLIENT-001`
- `HERMES-FORBID-CREDENTIAL-001`
- `HERMES-FORBID-LISTING-001`
- `HERMES-FORBID-REVENUE-001`

Forbidden fixtures must block and may only offer internal checklist, task, blocker, or reviewer-question alternatives.

## Evaluation report pattern

`sanitizeBookStudioHermesEvaluationReport()` produces a safe report with:

- `reportId`
- `skillKey`
- `status` (`pass`, `warning`, or `block`)
- `summary`
- `recommendations`
- `warnings`
- `blockers`
- `evidenceRefs`
- `reviewerDefault`
- `portalExposureRule`
- `nextActions`
- `runtimeDispatchAllowed: false`
- optional `forbiddenActionBlocked`

If a report payload contains runtime-dispatch fields, the sanitizer forces `status: block` and records the blocked dispatch field path.

## Sanitizer expectations

The Book Studio sanitizer now strips raw or unsafe Hermes-adjacent fields from stored records, including:

- raw prompts
- raw Hermes output
- unsafe recommendations
- unsupported claims
- parser errors
- internal/private notes
- credentials and account secrets
- marketplace publish or metadata mutation payloads
- unsafe URLs

Portal-safe exposure remains reviewed artifact version only.

## No-runtime-dispatch guard

`findBookStudioRuntimeDispatchFields()` detects dispatch-shaped payload fields such as:

- `runtimeDispatch`
- `dispatchSkill`
- `executeSkill`
- `executeHermesSkill`
- `hermesRun`
- `agentRunRequest`
- `toolCall`
- `runNow`
- `autoDispatch`

`createBookStudioResourceHandlers()` rejects POST payloads containing those fields with HTTP 403:

- `error: Book Studio Hermes runtime dispatch is not enabled in V1`
- `module: bookStudio`
- `runtimeDispatchAllowed: false`
- `blockedFields: [...]`

This is intentionally stronger than silent sanitizing: V1 may store specs and reports, but must not accept executable dispatch instructions inside Book Studio records.

## Verification commands

Focused verification for this artifact:

- `npm test -- --runInBand __tests__/api/book-studio-data-api.test.ts`
- targeted ESLint on `lib/book-studio/hermes.ts`, `lib/book-studio/routes.ts`, `lib/book-studio/sanitize.ts`, and `__tests__/api/book-studio-data-api.test.ts`

## Boundaries preserved

No production deploy, preview promotion, main merge, direct store publishing, marketplace credential custody, client self-serve generation, public SaaS, automated marketplace integration, ad/review automation, spend, finance, secret/config change, destructive action, live backfill, or runtime Hermes dispatch was performed.
