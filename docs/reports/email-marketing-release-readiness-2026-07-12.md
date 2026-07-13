# Email marketing release readiness — final engineering review

**Updated:** 2026-07-13

**Verified release candidate:** `2885f11c`

**Verdict:** **Engineering-ready for an internal, feature-flagged rollout.** All identified P0/P1 code blockers are implemented and independently reviewed. Production/client rollout still requires the external gates listed below; code completion is not legal approval, provider delivery proof, or production-release authority.

## Final requirement matrix

| Requirement | Status | Evidence | Remaining gate |
|---|---|---|---|
| Canonical program contracts/adapters | Complete | Canonical types, adapters, repository, validation, dry-run/preflight contracts and regression tests | Pilot data backfill/readback before enabling an existing organisation |
| Immutable audiences and estimates | Complete for governed send paths | Versioned audience snapshots, scoped resolution, estimates/deltas, approval snapshot binding | Signed-in UX review with a representative large audience |
| Sender identities and deterministic policies | Complete in code | Scoped sender-policy registry/editor, deterministic salesperson/fallback resolution, send-time policy checks | Provider-backed domain/identity proof and non-production test send |
| Reply routing and CRM handoff | Complete | Tenant-safe reply queue, ownership/SLA/escalation state, CRM handoff, stable paging, correction idempotency and collision protection | Signed-in operational walkthrough with real inbound test mail |
| Structured authoring/preflight | Complete for launch-critical workflow | Merge fields, snippets/blocks, preflight, preview, version-aware save and governed launch paths | Real inbox screenshots and manual accessibility review across target clients |
| Marketing Studio IA | Complete behind rollout flag | Per-org default-off `emailMarketingStudioV2`, safe legacy fallback, org/CRM context preservation, sender/reply/capture/journey controls | Enable only for the internal pilot org after signed-in browser walkthrough |
| Journey runtime | Complete | Recipient/org timezone, quiet hours, deterministic DST handling, immutable pinned workflow versions, exact-version approval, goals/exits, retries, dead letters and idempotent replay | Pilot observation of cron timing and provider responses |
| Capture conversion suite | Complete | Strict canonical schemas across primary/public/progressive/forms paths, immutable schema+display versions, progressive pinning, trusted vs observed attribution, hidden/unknown/future-step rejection, DOI preservation and honest funnel metrics | Public-page visual/accessibility walkthrough and production-domain Turnstile check |
| Consent and suppression enforcement | Complete | Affirmative marketing consent by default, explicit transactional bypass only, canonical send-time checks adjacent to providers, ledger precedence and failed-projection retry | Qualified legal review for target jurisdictions and final copy/policy sign-off |
| Immutable provider events | Complete | Tenant-safe provider targeting, immutable payload hashes/collision rejection, durable leases, stale recovery, transaction-coupled effects, reconciliation tooling and retry-on-effect failure | Non-production Resend/SES webhook canary with owned inboxes |
| Trustworthy analytics | Complete for implemented signals | Deterministic event effects/rebuild, honest funnel nulls, privacy-proxy classification, reply/conversion/revenue reconciliation foundations | Compare provider dashboards against pilot reconciliation report |
| Approval and agent governance | Complete | Exact same-org approval linkage, independent human maker-checker, immutable approval hashes, edit/schedule invalidation, activation/enrollment/send/replay gates and legacy fail-closed behavior | Apply/read back the new skill policy on managed runtimes |
| Tenant isolation | Complete for reviewed email surfaces | Adversarial route tests for capture, replies, approvals, webhooks, provider events and governed enrollments; every review stream approved with zero critical/important findings | Continue normal production security monitoring |
| Agent/VPS operating skills | Complete in repository | Capability manifest, hard gates and new `.claude/skills/email-marketing-governance/SKILL.md`; policy inventory test green | Sync to VPS, read back Maya/Blake/Vera/Pip/Nora/Theo/QA/Support inventories, then run safe canary prompts |
| Release gates | Engineering pass | 31 changed suites/160 tests; clean full Jest 1,332 suites/8,517 tests; typecheck; ESLint 0 errors; quality ratchet 714/198; `git diff --check`; Firestore JSON 186 indexes/10 overrides; production build 308/308 | Signed-in local QA, provider-owned canaries, legal approval, pilot approval and explicit production promotion |

## Safety and correctness closed in this continuation

- Failed consent/event compliance projections remain retryable and cannot be marked complete prematurely.
- Broadcast, campaign, sequence, automation, admin and public-capture entry points revalidate exact, same-organisation, maker-checker approval evidence.
- Reply correction requests are tenant-safe and replay-safe; stale/out-of-order retries return persisted current state rather than overwriting it.
- Journey execution uses the enrollment's integrity-checked immutable workflow and matching approval resource. Malformed claimed pins pause and audit instead of falling back to mutable content.
- Journey email/SMS failures retry and dead-letter without advancing the step; replay is organisation-scoped and idempotent.
- Capture attribution separates server-trusted lineage from observed/self-reported UTM/referrer values. Caller-supplied campaign/program/source/click authority is rejected.
- Every capture/form path resolves one canonical immutable schema. Progressive continuations use their pinned field and step layout after source edits; hidden, unknown and future-step values fail closed.
- Invalid stored capture validation patterns fail closed.
- A governed Hermes operating skill now exists for every policy assignment, with explicit stop conditions around approval, legal, provider, runtime and production gates.

## Independent review record

Four specialist streams were reviewed independently and looped until approval:

- Consent/provider events: approved, zero critical/important findings.
- Approval/governance: approved, zero critical/important findings.
- Reply queue and journey runtime: approved after exact-version approval and malformed-pin fail-closed corrections.
- Capture conversion: approved after trusted-lineage, immutable publication, strict form parity and progressive-version corrections; final 8 suites/51 tests.

## Verification record

- Changed email release suites: **31/31 suites, 160/160 tests**.
- Clean full repository suite: **1,332/1,332 suites, 8,517/8,517 tests**.
- TypeScript: pass.
- ESLint: pass with **0 errors** (repository warnings remain under existing policy).
- Quality ratchet: pass, `explicitAny=714`, `emptyCatch=198`.
- Firestore configuration: valid JSON, **186 indexes**, **10 field overrides**; new schema/version reads use direct document operations and require no new composite index.
- Production build: pass, **308/308 static pages** using the constrained one-worker configuration.
- Browser smoke: local `/portal/marketing` correctly redirects an unauthenticated profile to `/login`; signed-in local branch QA is blocked by absence of an owned local session. A production-authenticated Chrome tab was not treated as evidence for undeployed branch code.

## External launch gates — do not silently bypass

1. Obtain qualified legal review for consent language, retention, unsubscribe/preferences behavior and launch jurisdictions.
2. Sync/apply the repository skill policy on managed runtimes and read back exact inventories; run non-sending canary prompts.
3. Use owned test recipients to run non-production Resend/SES/inbound-reply/webhook canaries and reconcile provider dashboards.
4. Complete a signed-in browser walkthrough of Marketing Studio, sender policy, reply queue, capture builder and journey controls with the pilot flag enabled.
5. Approve an internal pilot, monitor delivery/complaints/replies/reconciliation, then explicitly approve the `development` to `main` production promotion.

No production deploy, provider send, client-visible message, legal acceptance or runtime-policy apply was performed by this engineering continuation.
