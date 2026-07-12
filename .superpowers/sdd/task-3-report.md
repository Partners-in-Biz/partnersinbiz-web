# Task 3 report: Strict runtime selection and execution identity

## Status

Complete.

## Red evidence

Command:

`npx jest __tests__/lib/agents/runtime-targets.test.ts __tests__/api/conversation-messages-routing.test.ts --runInBand`

Result before implementation: 2 suites failed, 7 tests failed, 23 passed. The failures proved that missing, disabled, stale, unhealthy, and keyless explicit local selections fell through to VPS/local, accepted runtime identity was absent from run metadata, and typed stale-selection failure details were not stored.

## Green evidence

Commands:

- `npx jest __tests__/lib/agents/runtime-targets.test.ts __tests__/api/conversation-messages-routing.test.ts --runInBand`
- `npx tsc --noEmit --pretty false`
- `git diff --check -- <Task 3 files>`

Results: 2 suites passed, 30 tests passed; TypeScript passed; diff check passed.

## Files

- `lib/agents/runtime-targets.ts`
- `lib/agents/team.ts`
- `lib/hermes/types.ts`
- `app/api/v1/conversations/[convId]/messages/route.ts`
- `__tests__/lib/agents/runtime-targets.test.ts`
- `__tests__/api/conversation-messages-routing.test.ts`

## Implementation

- Explicit target selection now returns typed errors for missing, disabled, stale local, unhealthy, and missing-key targets, without fallback.
- Auto selection retains its VPS, priority, and legacy fallback behavior.
- Dispatch targets and Hermes profile links preserve target ID, runtime kind, and a safe machine label.
- Unified chat records requested and accepted runtime identities in safe run metadata.
- Typed explicit-selection failures create no Hermes request and persist safe failure code/target fields on the assistant message.

## Commit

`fix(runtimes): enforce strict target selection`

## Self-review

- No connection URL or API key is added to run metadata or failure metadata.
- Explicit freshness is enforced only for local targets, matching the existing presence/freshness model.
- Existing auto/legacy behavior remains covered.
- Changes are confined to Task 3 files and this report.

## Concerns

None.
