# Email marketing V2 release-readiness review — 2026-07-12

Verdict: **Functionally strong but not release-ready.** The current implementation has strong canonical foundations, but it does not meet the plan's definition of world-class completeness and must remain off production rollout.

| Requirement | Status | Evidence | Gap/fix |
|---|---|---|---|
| Canonical program contracts/adapters | Complete | `lib/email-marketing/types.ts`, `adapters.ts`, `repository.ts`, `validation.ts`; focused tests green | Add planned dry-run/backfill report before rollout. |
| Immutable audiences and estimates | Partial | audience resolver/snapshot/version store and scoped APIs; focused tests green | Full nested behavioural/company/deal filter UI and audience-delta approval UX are incomplete. |
| Sender identities and deterministic policies | Complete | sender store/resolution/context, scoped APIs, broadcast and sequence integration; campaign authoring loads enabled organisation policies and persists `senderPolicyId`; table tests green | Signed-in UI QA, per-recipient audience preview and provider-backed identity/domain proof remain. Reply-policy selection remains blocked on a scoped registry/API. |
| Reply routing and CRM handoff | Partial | reply routing/classification libraries and tests exist | No complete reply queue/SLA/escalation UI and end-to-end CRM outcome proof. |
| Structured authoring/preflight | Partial | merge-field browser, preflight panel/API and tests exist | Version history, comments, snippets/global blocks, conflict handling, real inbox screenshots and full accessibility/link validation remain. |
| Marketing Studio IA | Partial | `/portal/marketing`, dashboard/nav/program list and tests exist; `emailMarketingStudioV2` is a safe default-off per-org flag with the legacy Marketing hub as fallback; scoped links preserve organisation and CRM company context | Admin opt-in and signed-in context-propagation/browser QA remain. |
| Journey runtime | Partial | leases, retries, sender failures, goals/branches/waits and canonical re-entry exist | Full trigger catalogue, quiet-hours/timezone/DST controls, immutable workflow versions, dead letters and simulation are incomplete. |
| Capture conversion suite | Partial | attribution and consent evidence exist on the primary capture/DOI path | Visual form/landing/popup builders, experiments, progressive profiling, abandonment analytics and full public-route parity are missing. |
| Consent and suppression enforcement | Partial | append-only ledger and precedence logic exist; preferences/suppression are checked in established send paths | Ledger truth is not yet projected/read as the canonical send-time decision across every executor. |
| Immutable provider events | Partial | event identity/store/projector/privacy classifier and webhook integration exist | Backfill/reconciliation scripts and proof that projector rebuild equals production rollups are absent. |
| Trustworthy analytics | Partial | privacy classifier and existing analytics foundations exist | Complete MPP labelling, reply/conversion/revenue reconciliation and provider drift reporting remain. |
| Approval and agent governance | Partial | named-agent hard allowlist; campaign/broadcast guards; sequence activation/enrollment guard added in this review | Broadcast human approval workflow, task-record validation, CRM/automation enrollment parity and all resume/activation surfaces remain to prove. |
| Tenant isolation | Partial | scoped sender/audience APIs and sender resolver reject cross-org identities | Full adversarial matrix across every listed public/webhook/reply/event resource has not been executed. |
| Agent/VPS operating skills | Partial | capability manifest and policy tests exist | Exact VPS inventories and canary prompts were not verified in this review. |
| Release gates | Missing | focused 20 suites/93 tests, typecheck, lint and diff-check pass | Full Jest, production build, signed-in browser QA, index review, provider test send, legal review and phased pilot are outstanding. |

## Security repair completed in this review

- Sequence updates now use an explicit editable-field allowlist, preventing request bodies from changing `orgId`, creator identity, deletion state, or other server-owned fields.
- Named-agent governance is enforced when a sequence is activated and when direct enrollment can initiate client-visible sends. Legacy shared AI keys cannot use those paths.
- Regression coverage: `__tests__/api/sequences-id.test.ts` and `__tests__/api/sequence-enrollments.test.ts`.

## Required release order

1. Finish approval/task validation, all activation/enrollment guards, and canonical send-time consent projection.
2. Complete webhook/public-route tenant adversarial tests and event reconciliation tooling.
3. Finish the P1 user workflows listed above and add the per-org rollout flag.
4. Run full test/lint/typecheck/build, Firestore index review, signed-in browser QA, non-production provider sends and VPS canaries.
5. Obtain qualified legal review of the compliance matrix; then run the internal and pilot rollout from Task 14.
