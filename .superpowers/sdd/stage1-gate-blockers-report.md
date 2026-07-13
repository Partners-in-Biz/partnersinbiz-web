# Stage 1 gate blockers report

Date: 2026-07-12

## Scope

- Repair the email reply-classification route type incompatibility with `TenantHandler`.
- Repair the reconciliation script's optional organisation ID type leak.
- Recheck the UnifiedChat project-pulse regression expecting `2 linked tasks` without changing Workspace semantics.

## RED evidence

Command:

```text
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit --pretty false --project tsconfig.typecheck.json
```

Before the fix this exited non-zero with exactly two errors:

```text
app/api/v1/email-marketing/replies/[id]/classification/route.ts(10,52): error TS2345: ... context ... Record<string, unknown> | undefined ...
scripts/reconcile-email-events.ts(46,48): error TS2322: Type 'string | undefined' is not assignable to type 'string'.
```

The UnifiedChat regression was rerun before these fixes:

```text
npm test -- --runInBand __tests__/components/chat/UnifiedChat.context.test.tsx
```

It was already green on the current shared tree: 1 suite, 27 tests passed. The previously reported `2 linked tasks` failure could not be reproduced after the concurrent project-chat files were present, so no Workspace or project-chat production code was changed in this repair.

## Root causes and minimal fixes

1. The classification route narrowed the optional middleware context parameter to a required dynamic-route shape. Function parameter contravariance made that callback incompatible with `TenantHandler`. The callback now accepts the middleware's generic context and narrows only `context.params` at its use site.
2. TypeScript does not retain the top-level `orgId` truthiness narrowing inside the deferred `main()` closure. The script now captures the validated value as `requiredOrgId` and uses it consistently. Runtime output, tenant checks, document IDs, queries, and writes retain the same semantics.

## GREEN evidence

```text
npm test -- --runInBand __tests__/api/v1/email-marketing/replies.test.ts __tests__/components/chat/UnifiedChat.context.test.tsx
```

Result: 2 suites passed, 31 tests passed.

```text
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit --pretty false --project tsconfig.typecheck.json
```

Result: exit 0, no diagnostics.

```text
git diff --check -- app/api/v1/email-marketing/replies/[id]/classification/route.ts scripts/reconcile-email-events.ts
```

Result: exit 0, no diagnostics.

## Commits

- `980a4ead2e5cb98b94618ae0937419950f1133e0` - `fix(email): restore strict typecheck`

## Self-review and concerns

- The repair changes types/narrowing only; it does not alter Workspace selection, project context, task linking, approval behavior, or reconciliation behavior.
- Existing project-chat changes remain uncommitted work owned by the concurrent shared-tree task and were not staged in the email fix commit.
- The UnifiedChat failure was not reproducible on the inspected tree. Its focused regression and the combined focused run are green, but this repair intentionally claims verification rather than authorship of the concurrent project-chat fix.

## Reviewer follow-up: dynamic route context validation

The reviewer correctly identified that the original use-site assertion still trusted `context.params` without runtime proof.

RED regression:

```text
npm test -- --runInBand __tests__/api/v1/email-marketing/replies.test.ts
```

The new malformed-context test failed as intended: `correctReplyClassification` received `undefined` instead of the required empty-ID fallback.

The route now uses structural `isRecord` and `isPromiseLike` guards, awaits only a validated thenable, validates the resolved object and string ID, and otherwise returns `''`. There is no unchecked route-parameter assertion.

GREEN evidence:

- Focused reply route suite: 1 suite passed, 5 tests passed.
- Raised-heap typecheck: exit 0, no diagnostics.
- Scoped diff check for the route and regression test: exit 0, no diagnostics.

Follow-up commit:

- `ea24bf4f008d8cd728baa90e5dc3f693b418089d` - `fix(email): validate dynamic route context`

Self-review: malformed, absent, non-thenable, non-object resolved values, and resolved objects without a string `id` all retain the empty-ID fallback. Valid Next.js promised params preserve the existing route behavior.
