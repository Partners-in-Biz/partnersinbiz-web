# Book Studio V2 Phase 1 — Publishing Lifecycle State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Book Studio an enforceable publishing lifecycle state machine —
`draft → content_complete → rights_cleared → assembled → qa_approved →
submission_ready → submitted → live → archived` — so assembly, packet, and
transition operations are gated by real guard checks instead of being inert
data records, with a transition endpoint (admin + portal, capability-gated)
as the *only* legal way to change `lifecycleState`.

**Architecture:** A new pure module `lib/book-studio/lifecycle.ts` owns the
state graph, guard functions, and the transactional "execute a transition"
primitive (project doc update + decision-log write in one Firestore
transaction, mirroring the dedupe-lock transaction pattern already proven in
`app/api/v1/portal/book-studio/projects/[id]/request-draft/route.ts`). Two
thin route handlers (admin `withAuth('admin')`, portal
`withPortalAuthAndRole('viewer')`) call into that module. The existing
generic PATCH routes (`app/api/v1/book-studio/[resource]/[id]/route.ts` and
its portal counterpart) are extended to reject direct writes to
`lifecycleState` with 403, using the same shape as the existing
`findBookStudioRuntimeDispatchFields` 403 block. The assemble route gains a
pre-flight `assertMinState` check. Two UI components get lifecycle-state
badges/actions wired to the new endpoints.

**Tech stack:** Next.js App Router route handlers, Firebase Admin Firestore
(`adminDb`, `FieldValue`, `runTransaction`), existing `apiSuccess`/`apiError`
envelope (`lib/api/response.ts`), existing `withAuth` (`lib/api/auth.ts`) and
`withPortalAuthAndRole` (`lib/auth/portal-middleware.ts`) middleware, Jest +
ts-jest for tests, existing `lib/book-studio/*` sanitize/capabilities/portal
helpers.

**Verified codebase facts this plan depends on (do not re-derive, just use):**

- `lib/book-studio/types.ts` — `BookStudioRecord` is a loose `{ [key: string]:
  unknown }` bag with named optional fields (`status`, `stage`, `channel`,
  etc). There is currently **no** `lifecycleState` field — Task 1 adds it and
  a dedicated `BookLifecycleState` union.
- `lib/book-studio/sanitize.ts:501-554` (`sanitizeBookStudioRecordInput`) and
  `:634-648` (`sanitizeBookStudioRecordPatch`) whitelist every field that
  survives create/patch. `lifecycleState` must **never** appear in either
  function's output — that is what makes direct PATCH un-writable at the data
  layer, independent of the 403 check in the route (defense in depth).
- The "reject a dangerous field on PATCH" pattern already lives in
  `lib/book-studio/hermes.ts:271-286`
  (`findBookStudioRuntimeDispatchFields`) and is consumed in two places:
  - `lib/book-studio/routes.ts:14-24` (`runtimeDispatchBlocked`, used by the
    generic admin PATCH handler in `createBookStudioRecordHandlers` at
    `lib/book-studio/routes.ts:79-135`)
  - `app/api/v1/portal/book-studio/[resource]/[id]/route.ts:44-45`
    (inlined call to `findBookStudioRuntimeDispatchFields`)
  Task 2 adds an equivalent `findLifecycleStateWriteAttempt(body)` helper in
  `lib/book-studio/lifecycle.ts` and wires it into both PATCH call sites the
  same way.
- `lib/book-studio/api.ts:62-83` (`ensureBookStudioAccess`) is the org-scoping
  + module-enabled guard every admin Book Studio route calls first. Reuse it
  verbatim in the new admin transition route.
- `lib/book-studio/portal.ts:6-19` (`portalBookStudioGuard`) is the portal
  equivalent — reuse it verbatim in the new portal transition route.
- `lib/book-studio/capabilities.ts:31-50`
  (`resolveBookStudioCapabilities`) returns a `BookStudioCapabilities` object
  including `canApprovalGates`. The acceptance criterion "portal role without
  `canApprovalGates` cannot transition past `content_complete`" is enforced by
  checking `caps.canApprovalGates` in the portal transition route before
  calling into `lifecycle.ts` for any `toState` beyond `content_complete`.
- Firestore transaction pattern to copy: see
  `app/api/v1/portal/book-studio/projects/[id]/request-draft/route.ts:76-128`.
  It reads a lock/guard doc first inside the transaction, then reads the
  target data, throws a sentinel `Error` subclass to abort+translate to an
  HTTP status, and does all writes (`tx.set`/`tx.create`/`tx.update`) before
  the transaction body returns. Task 3's `executeLifecycleTransition` follows
  the same shape but with `tx.update` on the project doc instead of
  `tx.create`.
- Decision-log shape actually written in this codebase (see
  `request-draft/route.ts:130-139` and `lib/book-studio/sanitize.ts:24`
  registering `decision-logs` with `titleField: 'decision'`):
  ```ts
  {
    orgId: string,
    projectId: string,
    decision: string,       // titleField for this resource
    title: string,
    safeSummary: string,
    ...portalActorFields(uid) | ...actorFields(user),
  }
  ```
  Phase 1's decision log for a lifecycle transition must use
  `decision: 'lifecycle_transition'` and include `fromState`, `toState`,
  `reason` (when provided) as additional fields — Task 3 defines the exact
  shape.
- `apiSuccess`/`apiError` (`lib/api/response.ts:4-21`): `apiSuccess(data,
  status?)` returns `{ success: true, data }`; `apiError(message, status,
  extra?)` returns `{ success: false, error: message, ...extra }` — the 422
  "blockers" response must use `apiError(message, 422, { blockers:
  string[] })` so blockers surface verbatim as the spec requires, matching
  the existing `apiError('pages are missing required image assets', 422, {
  missing: error.orders })` pattern in
  `app/api/v1/book-studio/projects/[id]/assemble/route.ts:44`.
- `withAuth('admin', handler)` (`lib/api/auth.ts:33`) — handler signature
  `(req: NextRequest, user: ApiUser, context?: any) => Promise<Response>`.
- `withPortalAuthAndRole(minRole, handler)` (`lib/auth/portal-middleware.ts:45`)
  — handler signature `(req, uid: string, orgId: string, role, context) =>
  Promise<Response>`.
- Test mocking pattern to copy exactly: see
  `__tests__/api/portal-book-studio-request-draft.test.ts:1-135` —
  `jest.mock('@/lib/firebase/admin', ...)` with a `mockCollection` +
  `mockRunTransaction`, a `stageFirestore()` helper that builds a fake
  Firestore per-collection, and a chained-promise `txChain` so
  `runTransaction` calls serialize like real pessimistic doc locks (used to
  test race conditions). Reuse this scaffold for the lifecycle transition
  route tests (Task 5) instead of inventing a new one.
- `components/book-studio/project/BookProjectHeader.tsx` currently renders a
  `project.status`/`project.stage` pill row and operator vs portal action
  buttons (`onAssemble`/`onOpenInCanvas` for operators,
  `onRequestDraft` for portal). Task 6 adds a `lifecycleState` pill plus a
  transition action menu, following the existing `StatusPill` /
  `humanizeToken` conventions from `components/book-studio/project/types.ts`.
- `components/book-studio/AdminBookStudioGovernanceWorkspace.tsx` is
  currently a *policy configuration* screen (role/action grid), not a board.
  Task 7 adds a new "Pipeline by lifecycle state" section to this same file
  (per the V2 spec's literal file reference) rather than creating a new
  component, to match the spec's explicit file list.
- Branch: all work happens directly on `development` (already checked out,
  confirmed clean via `git status --short --branch` →
  `## development...origin/development`, no local changes). No worktrees, no
  feature branches.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/book-studio/lifecycle.ts` (new) | State graph, guard functions, `assertMinState`, `findLifecycleStateWriteAttempt`, `executeLifecycleTransition` (the only place `lifecycleState` is ever written) |
| `__tests__/lib/book-studio-lifecycle.test.ts` (new) | Unit tests for the state graph + guards + transaction helper |
| `lib/book-studio/types.ts` (modify) | Add `BookLifecycleState` type + `lifecycleState?: BookLifecycleState` on `BookStudioRecord` |
| `lib/book-studio/routes.ts` (modify) | Admin generic PATCH handler rejects direct `lifecycleState` writes (403) |
| `app/api/v1/portal/book-studio/[resource]/[id]/route.ts` (modify) | Portal generic PATCH handler rejects direct `lifecycleState` writes (403) |
| `app/api/v1/book-studio/projects/[id]/transition/route.ts` (new) | Admin transition endpoint |
| `app/api/v1/portal/book-studio/projects/[id]/transition/route.ts` (new) | Portal transition endpoint, `canApprovalGates`-gated past `content_complete` |
| `__tests__/api/book-studio-transition-admin.test.ts` (new) | Admin transition route tests |
| `__tests__/api/book-studio-transition-portal.test.ts` (new) | Portal transition route tests |
| `app/api/v1/book-studio/projects/[id]/assemble/route.ts` (modify) | Refuse assembly unless `lifecycleState` >= `rights_cleared` |
| `__tests__/api/book-studio-assemble-lifecycle-gate.test.ts` (new) | Assemble-route 422 blocker tests |
| `components/book-studio/project/BookProjectHeader.tsx` (modify) | Lifecycle state badge + allowed-transition action buttons |
| `components/book-studio/project/types.ts` (modify) | Add `lifecycleState?: string` to `BookProject` |
| `components/book-studio/AdminBookStudioGovernanceWorkspace.tsx` (modify) | New "pipeline board by lifecycle state" section |

---

## Task 1: Lifecycle types + state graph (foundation — sequential, must land first)

**Files:**
- Modify: `lib/book-studio/types.ts`
- Create: `lib/book-studio/lifecycle.ts` (types + `TRANSITIONS` graph + `findLifecycleStateWriteAttempt` only in this task; guards land in Task 2)
- Test: `__tests__/lib/book-studio-lifecycle.test.ts`

**Design:**

```ts
// lib/book-studio/types.ts — add near the other unions
export type BookLifecycleState =
  | 'draft'
  | 'content_complete'
  | 'rights_cleared'
  | 'assembled'
  | 'qa_approved'
  | 'submission_ready'
  | 'submitted'
  | 'live'
  | 'archived'
```

Add `lifecycleState?: BookLifecycleState` to the `BookStudioRecord` type
(it already allows arbitrary extra keys via the index signature, but adding
the named optional field documents the contract and lets TypeScript narrow
it where used).

```ts
// lib/book-studio/lifecycle.ts
import type { BookLifecycleState } from './types'

export const LIFECYCLE_STATES: BookLifecycleState[] = [
  'draft', 'content_complete', 'rights_cleared', 'assembled',
  'qa_approved', 'submission_ready', 'submitted', 'live', 'archived',
]

export const DEFAULT_LIFECYCLE_STATE: BookLifecycleState = 'draft'

// Explicit allow-list. Forward moves follow the pipeline order; every
// non-archived state may also move back to 'draft' (reopen), which the
// transition route requires a `reason` for (enforced in Task 3/4, not here).
export const TRANSITIONS: Record<BookLifecycleState, BookLifecycleState[]> = {
  draft: ['content_complete'],
  content_complete: ['rights_cleared', 'draft'],
  rights_cleared: ['assembled', 'draft'],
  assembled: ['qa_approved', 'draft'],
  qa_approved: ['submission_ready', 'draft'],
  submission_ready: ['submitted', 'draft'],
  submitted: ['live', 'draft'],
  live: ['archived', 'draft'],
  archived: ['draft'],
}

export function isValidLifecycleState(value: unknown): value is BookLifecycleState {
  return typeof value === 'string' && (LIFECYCLE_STATES as string[]).includes(value)
}

/** Existing projects with no lifecycleState are treated as 'draft'. */
export function resolveLifecycleState(project: { lifecycleState?: unknown } | null | undefined): BookLifecycleState {
  return isValidLifecycleState(project?.lifecycleState) ? project!.lifecycleState as BookLifecycleState : DEFAULT_LIFECYCLE_STATE
}

export function isAllowedTransition(from: BookLifecycleState, to: BookLifecycleState): boolean {
  return TRANSITIONS[from].includes(to)
}

/**
 * Rank for "at least this far in the pipeline" checks (assertMinState).
 * 'draft' is reopen-only and never counts as satisfying a forward minimum —
 * ranks follow LIFECYCLE_STATES order, 'archived' is intentionally excluded
 * from ranking since it is a terminal side-branch, not a forward state.
 */
const STATE_RANK: Record<BookLifecycleState, number> = {
  draft: 0,
  content_complete: 1,
  rights_cleared: 2,
  assembled: 3,
  qa_approved: 4,
  submission_ready: 5,
  submitted: 6,
  live: 7,
  archived: -1,
}

export function meetsMinState(current: BookLifecycleState, min: BookLifecycleState): boolean {
  return STATE_RANK[current] >= STATE_RANK[min]
}

export class LifecycleStateTooLowError extends Error {
  blockers: string[]
  constructor(message: string, blockers: string[]) {
    super(message)
    this.name = 'LifecycleStateTooLowError'
    this.blockers = blockers
  }
}

/** Throws LifecycleStateTooLowError (caller maps to 422) if not met. */
export function assertMinState(
  project: { lifecycleState?: unknown; title?: unknown },
  min: BookLifecycleState,
): void {
  const current = resolveLifecycleState(project)
  if (meetsMinState(current, min)) return
  const title = typeof project.title === 'string' && project.title.trim() ? project.title.trim() : 'This book project'
  throw new LifecycleStateTooLowError(
    `${title} must reach lifecycle state "${min}" before this action (currently "${current}")`,
    [`lifecycleState must be at least "${min}" (currently "${current}")`],
  )
}

// --- Direct-PATCH blocking, mirrors findBookStudioRuntimeDispatchFields in
// lib/book-studio/hermes.ts:271-286 ---
export function findLifecycleStateWriteAttempt(body: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(body, 'lifecycleState')
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/book-studio-lifecycle.test.ts
import {
  LIFECYCLE_STATES,
  DEFAULT_LIFECYCLE_STATE,
  TRANSITIONS,
  isValidLifecycleState,
  resolveLifecycleState,
  isAllowedTransition,
  meetsMinState,
  assertMinState,
  LifecycleStateTooLowError,
  findLifecycleStateWriteAttempt,
} from '@/lib/book-studio/lifecycle'

describe('lifecycle state graph', () => {
  it('exposes all 9 states in pipeline order', () => {
    expect(LIFECYCLE_STATES).toEqual([
      'draft', 'content_complete', 'rights_cleared', 'assembled',
      'qa_approved', 'submission_ready', 'submitted', 'live', 'archived',
    ])
  })

  it('defaults missing lifecycleState to draft (migration-free default)', () => {
    expect(resolveLifecycleState(undefined)).toBe('draft')
    expect(resolveLifecycleState(null)).toBe('draft')
    expect(resolveLifecycleState({})).toBe('draft')
    expect(resolveLifecycleState({ lifecycleState: 'not-a-real-state' })).toBe('draft')
    expect(DEFAULT_LIFECYCLE_STATE).toBe('draft')
  })

  it('resolves a valid stored lifecycleState as-is', () => {
    expect(resolveLifecycleState({ lifecycleState: 'rights_cleared' })).toBe('rights_cleared')
  })

  it('validates known states only', () => {
    expect(isValidLifecycleState('draft')).toBe(true)
    expect(isValidLifecycleState('live')).toBe(true)
    expect(isValidLifecycleState('nope')).toBe(false)
    expect(isValidLifecycleState(123)).toBe(false)
  })

  it('allows only the explicit forward transition plus reopen-to-draft', () => {
    expect(isAllowedTransition('draft', 'content_complete')).toBe(true)
    expect(isAllowedTransition('content_complete', 'rights_cleared')).toBe(true)
    expect(isAllowedTransition('content_complete', 'draft')).toBe(true)
    expect(isAllowedTransition('archived', 'draft')).toBe(true)
  })

  it('rejects skipping states or moving backwards to a non-draft state', () => {
    expect(isAllowedTransition('draft', 'rights_cleared')).toBe(false)
    expect(isAllowedTransition('draft', 'assembled')).toBe(false)
    expect(isAllowedTransition('assembled', 'content_complete')).toBe(false)
    expect(isAllowedTransition('live', 'submitted')).toBe(false)
  })

  it('every state (except archived, reopen-only) has at least one forward transition', () => {
    const forwardOnly = Object.entries(TRANSITIONS).filter(([state]) => state !== 'archived')
    forwardOnly.forEach(([, targets]) => {
      expect(targets.length).toBeGreaterThan(0)
    })
  })

  describe('meetsMinState / assertMinState', () => {
    it('treats draft as not meeting any forward minimum', () => {
      expect(meetsMinState('draft', 'rights_cleared')).toBe(false)
    })

    it('treats a state equal to or past the minimum as meeting it', () => {
      expect(meetsMinState('rights_cleared', 'rights_cleared')).toBe(true)
      expect(meetsMinState('assembled', 'rights_cleared')).toBe(true)
      expect(meetsMinState('live', 'rights_cleared')).toBe(true)
    })

    it('assertMinState throws LifecycleStateTooLowError with blockers when not met', () => {
      expect(() => assertMinState({ lifecycleState: 'content_complete', title: 'My Book' }, 'rights_cleared'))
        .toThrow(LifecycleStateTooLowError)
      try {
        assertMinState({ lifecycleState: 'content_complete', title: 'My Book' }, 'rights_cleared')
        throw new Error('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(LifecycleStateTooLowError)
        expect((err as InstanceType<typeof LifecycleStateTooLowError>).blockers).toEqual([
          'lifecycleState must be at least "rights_cleared" (currently "content_complete")',
        ])
        expect((err as Error).message).toContain('My Book')
      }
    })

    it('assertMinState does not throw when the minimum is met', () => {
      expect(() => assertMinState({ lifecycleState: 'rights_cleared' }, 'rights_cleared')).not.toThrow()
    })

    it('assertMinState treats a missing lifecycleState as draft (fails any forward minimum)', () => {
      expect(() => assertMinState({}, 'content_complete')).toThrow(LifecycleStateTooLowError)
    })
  })

  describe('findLifecycleStateWriteAttempt', () => {
    it('detects a direct lifecycleState key in a PATCH body', () => {
      expect(findLifecycleStateWriteAttempt({ lifecycleState: 'live' })).toBe(true)
    })

    it('ignores bodies without lifecycleState', () => {
      expect(findLifecycleStateWriteAttempt({ status: 'approved' })).toBe(false)
    })

    it('detects an explicit undefined value (still an attempted write)', () => {
      expect(findLifecycleStateWriteAttempt({ lifecycleState: undefined })).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/book-studio-lifecycle.test.ts`
Expected: FAIL with "Cannot find module '@/lib/book-studio/lifecycle'"

- [ ] **Step 3: Implement `lib/book-studio/lifecycle.ts`**

Use the exact code block from the Design section above (types, constants,
`resolveLifecycleState`, `isAllowedTransition`, `meetsMinState`,
`assertMinState`, `LifecycleStateTooLowError`, `findLifecycleStateWriteAttempt`).
Also apply the `lib/book-studio/types.ts` edit: add the `BookLifecycleState`
export and `lifecycleState?: BookLifecycleState` field on `BookStudioRecord`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/book-studio-lifecycle.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors from `lib/book-studio/types.ts` or `lib/book-studio/lifecycle.ts`.

- [ ] **Step 6: Commit**

```bash
git add lib/book-studio/lifecycle.ts lib/book-studio/types.ts __tests__/lib/book-studio-lifecycle.test.ts
git commit -m "feat(book-studio): add lifecycle state graph and assertMinState guard"
```

---

## Task 2: Guard functions reading real data (sequential — depends on Task 1)

**Files:**
- Modify: `lib/book-studio/lifecycle.ts` (add guard functions + `runLifecycleGuard`)
- Test: `__tests__/lib/book-studio-lifecycle.test.ts` (extend with a new `describe('guards', ...)` block)

**Design:** Guards are pure functions taking already-fetched Firestore data
(never touching `adminDb` themselves) so they are trivially unit-testable and
reusable from both the transition route and any future background job. The
transition route (Task 3) is responsible for fetching the data these guards
need and passing it in.

```ts
// lib/book-studio/lifecycle.ts — append

export type GuardResult = { ok: boolean; blockers: string[] }

export type ContentCompleteGuardInput = {
  chapters: Array<{ status?: unknown }>
  pages: Array<{ status?: unknown }>
}

/** content_complete guard: every chapter/page status must be >= 'edited'. */
export function checkContentCompleteGuard(input: ContentCompleteGuardInput): GuardResult {
  const rank: Record<string, number> = { draft: 0, generated: 1, edited: 2, approved: 3 }
  const blockers: string[] = []
  input.chapters.forEach((chapter, index) => {
    const status = typeof chapter.status === 'string' ? chapter.status : 'draft'
    if ((rank[status] ?? 0) < rank.edited) {
      blockers.push(`chapter[${index}] status is "${status}", must be "edited" or "approved"`)
    }
  })
  input.pages.forEach((page, index) => {
    const status = typeof page.status === 'string' ? page.status : 'draft'
    if ((rank[status] ?? 0) < rank.edited) {
      blockers.push(`page[${index}] status is "${status}", must be "edited" or "approved"`)
    }
  })
  if (!input.chapters.length && !input.pages.length) {
    blockers.push('project has no chapters or pages to review')
  }
  return { ok: blockers.length === 0, blockers }
}

export type RightsClearedGuardInput = {
  rightsLedger?: { status?: unknown } | null
}

const CLEARED_RIGHTS_STATUSES = new Set(['cleared', 'owned', 'licensed', 'public_domain'])

/** rights_cleared guard: rights ledger status must be in the cleared set. */
export function checkRightsClearedGuard(input: RightsClearedGuardInput): GuardResult {
  const status = typeof input.rightsLedger?.status === 'string' ? input.rightsLedger.status : 'unknown'
  if (CLEARED_RIGHTS_STATUSES.has(status)) return { ok: true, blockers: [] }
  return { ok: false, blockers: [`rights ledger status is "${status}", must be one of: ${Array.from(CLEARED_RIGHTS_STATUSES).join(', ')}`] }
}

export type AssembledGuardInput = {
  packageManifest?: { status?: unknown; version?: unknown } | null
}

/** assembled guard: a package manifest must exist for the current content version. */
export function checkAssembledGuard(input: AssembledGuardInput): GuardResult {
  if (input.packageManifest && typeof input.packageManifest === 'object' && Object.keys(input.packageManifest).length) {
    return { ok: true, blockers: [] }
  }
  return { ok: false, blockers: ['no package manifest exists for this project yet — run assembly first'] }
}

export type QaApprovedGuardInput = {
  packageManifest?: { qaStatus?: unknown } | null
}

/** qa_approved guard: manifest qaStatus must be 'approved'. */
export function checkQaApprovedGuard(input: QaApprovedGuardInput): GuardResult {
  const qaStatus = typeof input.packageManifest?.qaStatus === 'string' ? input.packageManifest.qaStatus : 'missing_evidence'
  if (qaStatus === 'approved' /* aka 'pass' in BookStudioGateStatus terms handled by caller mapping */ || qaStatus === 'pass') {
    return { ok: true, blockers: [] }
  }
  return { ok: false, blockers: [`package manifest qaStatus is "${qaStatus}", must be "approved"`] }
}

/**
 * Guard registry keyed by the TARGET state of the transition (the state
 * being entered). States with no guard (draft, submission_ready, submitted,
 * live, archived) are intentionally unguarded in Phase 1 — submission_ready
 * validation is Phase 2's channel-metadata validator, submitted/live are
 * Phase 3's store-submission ops. Phase 1 only owns content/rights/assembly/QA.
 */
export const LIFECYCLE_GUARDS: Partial<Record<BookLifecycleState, (data: unknown) => GuardResult>> = {
  content_complete: (data) => checkContentCompleteGuard(data as ContentCompleteGuardInput),
  rights_cleared: (data) => checkRightsClearedGuard(data as RightsClearedGuardInput),
  assembled: (data) => checkAssembledGuard(data as AssembledGuardInput),
  qa_approved: (data) => checkQaApprovedGuard(data as QaApprovedGuardInput),
}

/** Runs the guard registered for `toState`, if any. No guard = always ok. */
export function runLifecycleGuard(toState: BookLifecycleState, data: unknown): GuardResult {
  const guard = LIFECYCLE_GUARDS[toState]
  if (!guard) return { ok: true, blockers: [] }
  return guard(data)
}
```

- [ ] **Step 1: Write the failing tests** (append to `__tests__/lib/book-studio-lifecycle.test.ts`)

```ts
import {
  checkContentCompleteGuard,
  checkRightsClearedGuard,
  checkAssembledGuard,
  checkQaApprovedGuard,
  runLifecycleGuard,
} from '@/lib/book-studio/lifecycle'

describe('lifecycle guards', () => {
  describe('checkContentCompleteGuard', () => {
    it('passes when every chapter/page is edited or approved', () => {
      const result = checkContentCompleteGuard({
        chapters: [{ status: 'edited' }, { status: 'approved' }],
        pages: [{ status: 'edited' }],
      })
      expect(result).toEqual({ ok: true, blockers: [] })
    })

    it('blocks with an index-labeled reason for each draft/generated unit', () => {
      const result = checkContentCompleteGuard({
        chapters: [{ status: 'draft' }],
        pages: [{ status: 'generated' }],
      })
      expect(result.ok).toBe(false)
      expect(result.blockers).toEqual([
        'chapter[0] status is "draft", must be "edited" or "approved"',
        'page[0] status is "generated", must be "edited" or "approved"',
      ])
    })

    it('blocks a project with no chapters or pages at all', () => {
      const result = checkContentCompleteGuard({ chapters: [], pages: [] })
      expect(result.ok).toBe(false)
      expect(result.blockers).toContain('project has no chapters or pages to review')
    })
  })

  describe('checkRightsClearedGuard', () => {
    it.each(['cleared', 'owned', 'licensed', 'public_domain'])('passes for rights status "%s"', (status) => {
      expect(checkRightsClearedGuard({ rightsLedger: { status } })).toEqual({ ok: true, blockers: [] })
    })

    it('blocks for needs_review', () => {
      const result = checkRightsClearedGuard({ rightsLedger: { status: 'needs_review' } })
      expect(result.ok).toBe(false)
      expect(result.blockers[0]).toContain('needs_review')
    })

    it('blocks when there is no rights ledger at all', () => {
      const result = checkRightsClearedGuard({ rightsLedger: null })
      expect(result.ok).toBe(false)
      expect(result.blockers[0]).toContain('unknown')
    })
  })

  describe('checkAssembledGuard', () => {
    it('passes when a package manifest exists', () => {
      expect(checkAssembledGuard({ packageManifest: { status: 'draft', version: '1' } })).toEqual({ ok: true, blockers: [] })
    })

    it('blocks when there is no manifest', () => {
      const result = checkAssembledGuard({ packageManifest: null })
      expect(result.ok).toBe(false)
    })
  })

  describe('checkQaApprovedGuard', () => {
    it('passes when qaStatus is approved or pass', () => {
      expect(checkQaApprovedGuard({ packageManifest: { qaStatus: 'pass' } }).ok).toBe(true)
    })

    it('blocks when qaStatus is missing_evidence or block', () => {
      expect(checkQaApprovedGuard({ packageManifest: { qaStatus: 'block' } }).ok).toBe(false)
      expect(checkQaApprovedGuard({ packageManifest: {} }).ok).toBe(false)
    })
  })

  describe('runLifecycleGuard', () => {
    it('runs the registered guard for a target state', () => {
      const result = runLifecycleGuard('rights_cleared', { rightsLedger: { status: 'cleared' } })
      expect(result.ok).toBe(true)
    })

    it('returns ok for target states with no registered guard', () => {
      expect(runLifecycleGuard('submission_ready', {})).toEqual({ ok: true, blockers: [] })
      expect(runLifecycleGuard('draft', {})).toEqual({ ok: true, blockers: [] })
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/book-studio-lifecycle.test.ts -t guards`
Expected: FAIL — guard exports don't exist yet.

- [ ] **Step 3: Implement the guard functions** — add the Design code block above to `lib/book-studio/lifecycle.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/book-studio-lifecycle.test.ts`
Expected: PASS (full file, both the Task 1 and Task 2 blocks).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add lib/book-studio/lifecycle.ts __tests__/lib/book-studio-lifecycle.test.ts
git commit -m "feat(book-studio): add lifecycle transition guards for content/rights/assembly/QA"
```

---

## Task 3: Transactional transition executor (sequential — depends on Task 1 + 2)

**Files:**
- Modify: `lib/book-studio/lifecycle.ts` (add `executeLifecycleTransition`)
- Test: `__tests__/lib/book-studio-lifecycle.test.ts` (extend)

**Design:** This is the single function both route handlers (Task 4) call.
It does NOT touch `adminDb` directly — it receives a `db` (typed loosely as
`FirebaseFirestore.Firestore`-shaped, so it is mockable exactly like
`request-draft/route.ts` mocks `adminDb`) plus the already-fetched guard data,
and performs one `runTransaction` that (a) re-reads the project doc inside
the transaction for freshness, (b) re-validates the transition is still
legal (defends against a race where the project changed between the route's
pre-check and the transaction), (c) updates `lifecycleState` on the project
doc, and (d) writes the decision log — all inside the same transaction, per
the spec's "same Firestore transaction" requirement.

```ts
// lib/book-studio/lifecycle.ts — append

export class LifecycleTransitionNotAllowedError extends Error {
  constructor(from: BookLifecycleState, to: BookLifecycleState) {
    super(`Cannot transition from "${from}" to "${to}"`)
    this.name = 'LifecycleTransitionNotAllowedError'
  }
}

export class LifecycleReopenReasonRequiredError extends Error {
  constructor() {
    super('A reason is required when reopening a project back to "draft"')
    this.name = 'LifecycleReopenReasonRequiredError'
  }
}

export type LifecycleActor = { uid: string; actorType: 'user' | 'agent' }

export type ExecuteLifecycleTransitionParams = {
  // Minimal Firestore-like surface so this stays mockable the same way
  // request-draft/route.ts mocks adminDb — see lib/firebase/admin's adminDb type.
  db: {
    collection: (name: string) => FirebaseFirestore.CollectionReference
    runTransaction: <T>(fn: (tx: FirebaseFirestore.Transaction) => Promise<T>) => Promise<T>
  }
  orgId: string
  projectId: string
  toState: BookLifecycleState
  guardData: unknown
  actor: LifecycleActor
  reason?: string
}

export async function executeLifecycleTransition(params: ExecuteLifecycleTransitionParams): Promise<{ from: BookLifecycleState; to: BookLifecycleState }> {
  const { db, orgId, projectId, toState, guardData, actor, reason } = params
  const projectRef = db.collection('book_studio_projects').doc(projectId)
  const decisionLogRef = db.collection('book_studio_decision_logs').doc()

  let fromState: BookLifecycleState = 'draft'

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(projectRef)
    if (!snap.exists) throw new LifecycleTransitionNotAllowedError('draft', toState)
    const project = snap.data() as Record<string, unknown>
    if (project.orgId !== orgId || project.deleted === true) {
      throw new LifecycleTransitionNotAllowedError('draft', toState)
    }

    fromState = resolveLifecycleState(project)
    if (!isAllowedTransition(fromState, toState)) {
      throw new LifecycleTransitionNotAllowedError(fromState, toState)
    }
    if (toState === 'draft' && !reason?.trim()) {
      throw new LifecycleReopenReasonRequiredError()
    }

    const guardResult = runLifecycleGuard(toState, guardData)
    if (!guardResult.ok) {
      throw new LifecycleStateTooLowError(
        `Cannot transition to "${toState}": ${guardResult.blockers.join('; ')}`,
        guardResult.blockers,
      )
    }

    tx.update(projectRef, {
      lifecycleState: toState,
      updatedBy: actor.uid,
      updatedByType: actor.actorType,
      updatedAt: FieldValue.serverTimestamp(),
    })

    tx.create(decisionLogRef, {
      orgId,
      projectId,
      decision: 'lifecycle_transition',
      title: `Lifecycle transition: ${fromState} → ${toState}`,
      safeSummary: reason?.trim()
        ? `Transitioned from "${fromState}" to "${toState}". Reason: ${reason.trim()}`
        : `Transitioned from "${fromState}" to "${toState}".`,
      fromState,
      toState,
      reason: reason?.trim() || undefined,
      createdBy: actor.uid,
      createdByType: actor.actorType,
      updatedBy: actor.uid,
      updatedByType: actor.actorType,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  })

  return { from: fromState, to: toState }
}
```

Add the `FieldValue` import at the top of `lib/book-studio/lifecycle.ts`:
`import { FieldValue } from 'firebase-admin/firestore'`.

- [ ] **Step 1: Write the failing tests** (append to `__tests__/lib/book-studio-lifecycle.test.ts`)

```ts
describe('executeLifecycleTransition', () => {
  function makeFakeDb(project: Record<string, unknown> | null) {
    const projectDoc = { ...project }
    const updateSpy = jest.fn((patch: Record<string, unknown>) => Object.assign(projectDoc, patch))
    const createSpy = jest.fn()
    const projectRef = { get: async () => ({ exists: Boolean(project), data: () => projectDoc }) }
    const decisionLogRef = {}
    const collection = jest.fn((name: string) => {
      if (name === 'book_studio_projects') return { doc: () => projectRef } as unknown as FirebaseFirestore.CollectionReference
      if (name === 'book_studio_decision_logs') return { doc: () => decisionLogRef } as unknown as FirebaseFirestore.CollectionReference
      throw new Error(`unexpected collection ${name}`)
    })
    const tx = {
      get: async (ref: unknown) => (ref as { get: () => Promise<unknown> }).get(),
      update: updateSpy,
      create: createSpy,
    }
    const runTransaction = jest.fn(async (fn: (tx: unknown) => Promise<void>) => fn(tx))
    return { db: { collection, runTransaction } as never, updateSpy, createSpy }
  }

  it('updates lifecycleState and writes a decision log in the same transaction', async () => {
    const { db, updateSpy, createSpy } = makeFakeDb({ orgId: 'org-1', lifecycleState: 'content_complete', deleted: false })
    const result = await executeLifecycleTransition({
      db, orgId: 'org-1', projectId: 'proj-1', toState: 'rights_cleared',
      guardData: { rightsLedger: { status: 'cleared' } },
      actor: { uid: 'uid-1', actorType: 'user' },
    })
    expect(result).toEqual({ from: 'content_complete', to: 'rights_cleared' })
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ lifecycleState: 'rights_cleared' }))
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'lifecycle_transition', fromState: 'content_complete', toState: 'rights_cleared',
    }))
  })

  it('throws LifecycleTransitionNotAllowedError for a disallowed jump', async () => {
    const { db } = makeFakeDb({ orgId: 'org-1', lifecycleState: 'draft', deleted: false })
    await expect(executeLifecycleTransition({
      db, orgId: 'org-1', projectId: 'proj-1', toState: 'rights_cleared',
      guardData: {}, actor: { uid: 'uid-1', actorType: 'user' },
    })).rejects.toBeInstanceOf(LifecycleTransitionNotAllowedError)
  })

  it('throws LifecycleStateTooLowError with blockers when the guard fails', async () => {
    const { db } = makeFakeDb({ orgId: 'org-1', lifecycleState: 'content_complete', deleted: false })
    await expect(executeLifecycleTransition({
      db, orgId: 'org-1', projectId: 'proj-1', toState: 'rights_cleared',
      guardData: { rightsLedger: { status: 'needs_review' } },
      actor: { uid: 'uid-1', actorType: 'user' },
    })).rejects.toBeInstanceOf(LifecycleStateTooLowError)
  })

  it('requires a reason when reopening to draft', async () => {
    const { db } = makeFakeDb({ orgId: 'org-1', lifecycleState: 'assembled', deleted: false })
    await expect(executeLifecycleTransition({
      db, orgId: 'org-1', projectId: 'proj-1', toState: 'draft',
      guardData: {}, actor: { uid: 'uid-1', actorType: 'user' },
    })).rejects.toBeInstanceOf(LifecycleReopenReasonRequiredError)
  })

  it('allows reopening to draft when a reason is given', async () => {
    const { db, updateSpy } = makeFakeDb({ orgId: 'org-1', lifecycleState: 'assembled', deleted: false })
    const result = await executeLifecycleTransition({
      db, orgId: 'org-1', projectId: 'proj-1', toState: 'draft',
      guardData: {}, actor: { uid: 'uid-1', actorType: 'user' }, reason: 'Client requested rewrite',
    })
    expect(result.to).toBe('draft')
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ lifecycleState: 'draft' }))
  })

  it('throws when the project belongs to another org', async () => {
    const { db } = makeFakeDb({ orgId: 'org-2', lifecycleState: 'draft', deleted: false })
    await expect(executeLifecycleTransition({
      db, orgId: 'org-1', projectId: 'proj-1', toState: 'content_complete',
      guardData: {}, actor: { uid: 'uid-1', actorType: 'user' },
    })).rejects.toBeInstanceOf(LifecycleTransitionNotAllowedError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/book-studio-lifecycle.test.ts -t executeLifecycleTransition`
Expected: FAIL — `executeLifecycleTransition` not exported yet.

- [ ] **Step 3: Implement** — add the Design code block to `lib/book-studio/lifecycle.ts`, add the `FieldValue` import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/book-studio-lifecycle.test.ts`
Expected: PASS, full file (Tasks 1–3 combined).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add lib/book-studio/lifecycle.ts __tests__/lib/book-studio-lifecycle.test.ts
git commit -m "feat(book-studio): add transactional lifecycle transition executor"
```

---

## Task 4: Admin + portal transition routes (parallel-safe with Task 5/6/7 once Tasks 1-3 are merged; the two routes in this task can be split across two agents in parallel since they touch disjoint files)

**Files:**
- Create: `app/api/v1/book-studio/projects/[id]/transition/route.ts`
- Create: `app/api/v1/portal/book-studio/projects/[id]/transition/route.ts`
- Test: `__tests__/api/book-studio-transition-admin.test.ts`
- Test: `__tests__/api/book-studio-transition-portal.test.ts`

**Design — admin route:**

```ts
// app/api/v1/book-studio/projects/[id]/transition/route.ts
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { ensureBookStudioAccess } from '@/lib/book-studio/api'
import {
  executeLifecycleTransition,
  isValidLifecycleState,
  LifecycleReopenReasonRequiredError,
  LifecycleStateTooLowError,
  LifecycleTransitionNotAllowedError,
} from '@/lib/book-studio/lifecycle'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req: NextRequest, user, context: Ctx) => {
  const { id: projectId } = await context.params

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Malformed JSON body', 400)
  }

  const access = await ensureBookStudioAccess(req, user, body, 'write')
  if (access.error) return access.error
  const orgId = access.orgId

  const toState = body.toState
  if (!isValidLifecycleState(toState)) return apiError('toState must be a valid lifecycle state', 400)
  const reason = typeof body.reason === 'string' ? body.reason : undefined

  const guardData = await loadGuardData(projectId, toState)

  try {
    const result = await executeLifecycleTransition({
      db: adminDb, orgId, projectId, toState, guardData, reason,
      actor: { uid: user.uid, actorType: user.role === 'ai' ? 'agent' : 'user' },
    })
    return apiSuccess(result)
  } catch (error) {
    if (error instanceof LifecycleStateTooLowError) return apiError(error.message, 422, { blockers: error.blockers })
    if (error instanceof LifecycleTransitionNotAllowedError) return apiError(error.message, 400)
    if (error instanceof LifecycleReopenReasonRequiredError) return apiError(error.message, 400)
    throw error
  }
})

// Loads exactly the data the guard for `toState` needs. Kept in the route
// (not lifecycle.ts) because it is the only place allowed to call adminDb —
// lifecycle.ts guards stay pure/unit-testable per Task 2's design.
async function loadGuardData(projectId: string, toState: string) {
  if (toState === 'content_complete') {
    const [chaptersSnap, pagesSnap] = await Promise.all([
      adminDb.collection('book_studio_chapters').where('projectId', '==', projectId).get(),
      adminDb.collection('book_studio_pages').where('projectId', '==', projectId).get(),
    ])
    return {
      chapters: chaptersSnap.docs.map((doc) => doc.data()),
      pages: pagesSnap.docs.map((doc) => doc.data()),
    }
  }
  if (toState === 'rights_cleared' || toState === 'assembled' || toState === 'qa_approved') {
    const projectSnap = await adminDb.collection('book_studio_projects').doc(projectId).get()
    const project = projectSnap.data() ?? {}
    return { rightsLedger: project.rightsLedger, packageManifest: project.packageManifest }
  }
  return {}
}
```

**Design — portal route:** same shape, but capability-gated. Cap at
`content_complete` for roles without `canApprovalGates` per the acceptance
criterion.

```ts
// app/api/v1/portal/book-studio/projects/[id]/transition/route.ts
import { NextRequest } from 'next/server'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { portalBookStudioGuard } from '@/lib/book-studio/portal'
import { resolveBookStudioCapabilities } from '@/lib/book-studio/capabilities'
import {
  LIFECYCLE_STATES,
  executeLifecycleTransition,
  isValidLifecycleState,
  LifecycleReopenReasonRequiredError,
  LifecycleStateTooLowError,
  LifecycleTransitionNotAllowedError,
} from '@/lib/book-studio/lifecycle'
import type { BookLifecycleState } from '@/lib/book-studio/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

// Index in LIFECYCLE_STATES a caller without canApprovalGates may not pass.
const CONTENT_COMPLETE_RANK = LIFECYCLE_STATES.indexOf('content_complete')

export const POST = withPortalAuthAndRole('viewer', async (req: NextRequest, uid: string, orgId: string, role, context: Ctx) => {
  const { id: projectId } = await context.params

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Malformed JSON body', 400)
  }

  const guard = await portalBookStudioGuard(orgId)
  if (guard.error) return guard.error
  const caps = resolveBookStudioCapabilities(guard.settings, role, false)
  if (!caps.canEdit) return apiError('Your role does not have access to this Book Studio action', 403)

  const toState = body.toState
  if (!isValidLifecycleState(toState)) return apiError('toState must be a valid lifecycle state', 400)

  const targetRank = LIFECYCLE_STATES.indexOf(toState as BookLifecycleState)
  if (!caps.canApprovalGates && targetRank > CONTENT_COMPLETE_RANK) {
    return apiError('Your role can only progress Book Studio projects up to "content_complete"', 403)
  }

  const reason = typeof body.reason === 'string' ? body.reason : undefined
  const guardData = await loadGuardData(projectId, toState)

  try {
    const result = await executeLifecycleTransition({
      db: adminDb, orgId, projectId, toState, guardData, reason,
      actor: { uid, actorType: 'user' },
    })
    return apiSuccess(result)
  } catch (error) {
    if (error instanceof LifecycleStateTooLowError) return apiError(error.message, 422, { blockers: error.blockers })
    if (error instanceof LifecycleTransitionNotAllowedError) return apiError(error.message, 400)
    if (error instanceof LifecycleReopenReasonRequiredError) return apiError(error.message, 400)
    throw error
  }
})

async function loadGuardData(projectId: string, toState: string) {
  if (toState === 'content_complete') {
    const [chaptersSnap, pagesSnap] = await Promise.all([
      adminDb.collection('book_studio_chapters').where('projectId', '==', projectId).get(),
      adminDb.collection('book_studio_pages').where('projectId', '==', projectId).get(),
    ])
    return {
      chapters: chaptersSnap.docs.map((doc) => doc.data()),
      pages: pagesSnap.docs.map((doc) => doc.data()),
    }
  }
  if (toState === 'rights_cleared' || toState === 'assembled' || toState === 'qa_approved') {
    const projectSnap = await adminDb.collection('book_studio_projects').doc(projectId).get()
    const project = projectSnap.data() ?? {}
    return { rightsLedger: project.rightsLedger, packageManifest: project.packageManifest }
  }
  return {}
}
```

**Note on duplication:** `loadGuardData` is intentionally duplicated between
the two routes rather than shared, matching this codebase's existing
preference for route-local data loading (see how assemble's error mapping is
route-local, not shared). If a third transition entrypoint is ever added,
extract `loadGuardData` into `lib/book-studio/lifecycle-guard-data.ts` at that
point — YAGNI for now with only two call sites.

- [ ] **Step 1: Write the failing admin route test**

```ts
// __tests__/api/book-studio-transition-admin.test.ts
import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockRunTransaction = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    runTransaction: (fn: (tx: unknown) => Promise<void>) => mockRunTransaction(fn),
  },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: unknown, ctx: unknown) => unknown) =>
    (req: NextRequest, ctx: unknown) => handler(req, { uid: 'admin-1', role: 'admin' }, ctx),
}))

jest.mock('@/lib/api/platformAdmin', () => ({ canAccessOrg: () => true }))
jest.mock('@/lib/organizations/portal-modules', () => ({ isPortalModuleEnabled: () => true }))

type DocRecord = Record<string, unknown>

function stageFirestore(options: { project: DocRecord | null; chapters?: DocRecord[]; pages?: DocRecord[] }) {
  const { project, chapters = [], pages = [] } = options
  const projectDoc = { ...project }
  const updateSpy = jest.fn((patch: Record<string, unknown>) => Object.assign(projectDoc, patch))
  const createSpy = jest.fn()
  const orgGet = jest.fn().mockResolvedValue({ exists: true, data: () => ({ settings: { portalModules: { bookStudio: true } } }) })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { doc: () => ({ get: orgGet }) }
    if (name === 'book_studio_projects') {
      return { doc: () => ({ get: async () => ({ exists: Boolean(project), data: () => projectDoc }) }) }
    }
    if (name === 'book_studio_decision_logs') return { doc: () => ({}) }
    if (name === 'book_studio_chapters') {
      return { where: () => ({ get: async () => ({ docs: chapters.map((data) => ({ data: () => data })) }) }) }
    }
    if (name === 'book_studio_pages') {
      return { where: () => ({ get: async () => ({ docs: pages.map((data) => ({ data: () => data })) }) }) }
    }
    throw new Error(`unexpected collection ${name}`)
  })

  mockRunTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    const projectRef = { get: async () => ({ exists: Boolean(project), data: () => projectDoc }) }
    const tx = { get: (ref: { get: () => Promise<unknown> }) => ref.get(), update: updateSpy, create: createSpy }
    return fn(tx)
  })

  return { updateSpy, createSpy }
}

function makeRequest(body: Record<string, unknown>, orgId = 'org-1') {
  return new NextRequest(`http://localhost/api/v1/book-studio/projects/proj-1/transition?orgId=${orgId}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/book-studio/projects/[id]/transition', () => {
  beforeEach(() => { jest.clearAllMocks() })

  it('200s and updates lifecycleState on an allowed transition', async () => {
    stageFirestore({
      project: { orgId: 'org-1', lifecycleState: 'draft', deleted: false },
      chapters: [{ status: 'edited' }],
      pages: [{ status: 'approved' }],
    })
    const { POST } = await import('@/app/api/v1/book-studio/projects/[id]/transition/route')
    const res = await POST(makeRequest({ toState: 'content_complete' }), { params: Promise.resolve({ id: 'proj-1' }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data).toEqual({ from: 'draft', to: 'content_complete' })
  })

  it('422s with blockers when the guard fails', async () => {
    stageFirestore({
      project: { orgId: 'org-1', lifecycleState: 'draft', deleted: false },
      chapters: [{ status: 'draft' }],
      pages: [],
    })
    const { POST } = await import('@/app/api/v1/book-studio/projects/[id]/transition/route')
    const res = await POST(makeRequest({ toState: 'content_complete' }), { params: Promise.resolve({ id: 'proj-1' }) })
    const body = await res.json()
    expect(res.status).toBe(422)
    expect(body.success).toBe(false)
    expect(Array.isArray(body.blockers)).toBe(true)
    expect(body.blockers.length).toBeGreaterThan(0)
  })

  it('400s on an invalid toState', async () => {
    stageFirestore({ project: { orgId: 'org-1', lifecycleState: 'draft', deleted: false } })
    const { POST } = await import('@/app/api/v1/book-studio/projects/[id]/transition/route')
    const res = await POST(makeRequest({ toState: 'not-a-state' }), { params: Promise.resolve({ id: 'proj-1' }) })
    expect(res.status).toBe(400)
  })

  it('400s on a disallowed skip-ahead transition', async () => {
    stageFirestore({ project: { orgId: 'org-1', lifecycleState: 'draft', deleted: false } })
    const { POST } = await import('@/app/api/v1/book-studio/projects/[id]/transition/route')
    const res = await POST(makeRequest({ toState: 'live' }), { params: Promise.resolve({ id: 'proj-1' }) })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run the admin test to verify it fails**

Run: `npx jest __tests__/api/book-studio-transition-admin.test.ts`
Expected: FAIL — route module doesn't exist.

- [ ] **Step 3: Implement the admin route** — create `app/api/v1/book-studio/projects/[id]/transition/route.ts` with the Design code above.

- [ ] **Step 4: Run the admin test to verify it passes**

Run: `npx jest __tests__/api/book-studio-transition-admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing portal route test**

```ts
// __tests__/api/book-studio-transition-portal.test.ts
import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockRunTransaction = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    runTransaction: (fn: (tx: unknown) => Promise<void>) => mockRunTransaction(fn),
  },
}))

jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuthAndRole: (_minRole: string, handler: (req: NextRequest, uid: string, orgId: string, role: string, ctx: unknown) => unknown) =>
    (req: NextRequest, ctx: unknown) => handler(req, 'uid-1', 'org-1', (req as unknown as { __role?: string }).__role || 'member', ctx),
}))

type DocRecord = Record<string, unknown>

function stageFirestore(options: { settings: Record<string, unknown>; project: DocRecord | null; chapters?: DocRecord[]; pages?: DocRecord[] }) {
  const { settings, project, chapters = [], pages = [] } = options
  const projectDoc = { ...project }
  const updateSpy = jest.fn((patch: Record<string, unknown>) => Object.assign(projectDoc, patch))
  const createSpy = jest.fn()
  const orgGet = jest.fn().mockResolvedValue({ exists: true, data: () => ({ settings }) })

  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { doc: () => ({ get: orgGet }) }
    if (name === 'book_studio_projects') return { doc: () => ({ get: async () => ({ exists: Boolean(project), data: () => projectDoc }) }) }
    if (name === 'book_studio_decision_logs') return { doc: () => ({}) }
    if (name === 'book_studio_chapters') return { where: () => ({ get: async () => ({ docs: chapters.map((data) => ({ data: () => data })) }) }) }
    if (name === 'book_studio_pages') return { where: () => ({ get: async () => ({ docs: pages.map((data) => ({ data: () => data })) }) }) }
    throw new Error(`unexpected collection ${name}`)
  })

  mockRunTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    const tx = {
      get: (ref: { get: () => Promise<unknown> }) => ref.get(),
      update: updateSpy,
      create: createSpy,
    }
    return fn(tx)
  })

  return { updateSpy, createSpy }
}

const NO_APPROVAL_GATES_SETTINGS = {
  portalModules: { bookStudio: true },
  modulePolicies: {
    bookStudio: { actions: { edit: { owner: true, admin: true, member: true }, approvalGates: { owner: true, admin: true, member: false } } },
  },
}
const WITH_APPROVAL_GATES_SETTINGS = {
  portalModules: { bookStudio: true },
  modulePolicies: {
    bookStudio: { actions: { edit: { owner: true, admin: true, member: true }, approvalGates: { owner: true, admin: true, member: true } } },
  },
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/v1/portal/book-studio/projects/proj-1/transition', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/portal/book-studio/projects/[id]/transition', () => {
  beforeEach(() => { jest.clearAllMocks() })

  it('allows a member without canApprovalGates to reach content_complete', async () => {
    stageFirestore({
      settings: NO_APPROVAL_GATES_SETTINGS,
      project: { orgId: 'org-1', lifecycleState: 'draft', deleted: false },
      chapters: [{ status: 'edited' }],
      pages: [],
    })
    const { POST } = await import('@/app/api/v1/portal/book-studio/projects/[id]/transition/route')
    const res = await POST(makeRequest({ toState: 'content_complete' }), { params: Promise.resolve({ id: 'proj-1' }) })
    expect(res.status).toBe(200)
  })

  it('403s a member without canApprovalGates trying to reach rights_cleared', async () => {
    stageFirestore({
      settings: NO_APPROVAL_GATES_SETTINGS,
      project: { orgId: 'org-1', lifecycleState: 'content_complete', deleted: false },
    })
    const { POST } = await import('@/app/api/v1/portal/book-studio/projects/[id]/transition/route')
    const res = await POST(makeRequest({ toState: 'rights_cleared' }), { params: Promise.resolve({ id: 'proj-1' }) })
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.success).toBe(false)
  })

  it('allows a member with canApprovalGates to reach rights_cleared', async () => {
    stageFirestore({
      settings: WITH_APPROVAL_GATES_SETTINGS,
      project: { orgId: 'org-1', lifecycleState: 'content_complete', rightsLedger: { status: 'cleared' }, deleted: false },
    })
    const { POST } = await import('@/app/api/v1/portal/book-studio/projects/[id]/transition/route')
    const res = await POST(makeRequest({ toState: 'rights_cleared' }), { params: Promise.resolve({ id: 'proj-1' }) })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 6: Run the portal test to verify it fails**

Run: `npx jest __tests__/api/book-studio-transition-portal.test.ts`
Expected: FAIL — route module doesn't exist.

- [ ] **Step 7: Implement the portal route** — create `app/api/v1/portal/book-studio/projects/[id]/transition/route.ts` with the Design code above.

- [ ] **Step 8: Run both transition route tests to verify they pass**

Run: `npx jest __tests__/api/book-studio-transition-admin.test.ts __tests__/api/book-studio-transition-portal.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 10: Commit**

```bash
git add app/api/v1/book-studio/projects/[id]/transition/route.ts \
        app/api/v1/portal/book-studio/projects/[id]/transition/route.ts \
        __tests__/api/book-studio-transition-admin.test.ts \
        __tests__/api/book-studio-transition-portal.test.ts
git commit -m "feat(book-studio): add admin and portal lifecycle transition routes"
```

---

## Task 5: Block direct PATCH of lifecycleState (parallel-safe with Task 4, 6, 7 — depends only on Task 1)

**Files:**
- Modify: `lib/book-studio/routes.ts` (admin generic PATCH)
- Modify: `app/api/v1/portal/book-studio/[resource]/[id]/route.ts` (portal generic PATCH)
- Test: `__tests__/api/book-studio-routes-lifecycle-patch-block.test.ts` (new)

**Design:** Both PATCH handlers already run a "blocked field" check before
sanitizing the body (`runtimeDispatchBlocked` in `routes.ts:53,96` and the
inline `findBookStudioRuntimeDispatchFields` call in the portal
`[resource]/[id]/route.ts:44-45`). Add a second check right next to it using
`findLifecycleStateWriteAttempt` from Task 1, returning 403 with the same
response shape style as the existing block.

Edit 1 — `lib/book-studio/routes.ts`:

```ts
// add to the import from './hermes' line's neighborhood
import { findLifecycleStateWriteAttempt } from './lifecycle'

// new helper, alongside runtimeDispatchBlocked
function lifecycleStateWriteBlocked(body: Record<string, unknown>) {
  if (!findLifecycleStateWriteAttempt(body)) return null
  return Response.json({
    success: false,
    error: 'lifecycleState can only be changed via the /transition endpoint',
  }, { status: 403 })
}
```

Then inside `createBookStudioRecordHandlers`'s `PATCH`, immediately after the
existing `const dispatchBlocked = runtimeDispatchBlocked(body); if
(dispatchBlocked) return dispatchBlocked` block (around `routes.ts:96-97`),
add:

```ts
const lifecycleBlocked = lifecycleStateWriteBlocked(body)
if (lifecycleBlocked) return lifecycleBlocked
```

Edit 2 — `app/api/v1/portal/book-studio/[resource]/[id]/route.ts`: add the
same import and, immediately after the existing dispatch-fields check at
lines 44-45, add:

```ts
if (findLifecycleStateWriteAttempt(body)) {
  return apiError('lifecycleState can only be changed via the /transition endpoint', 403)
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/api/book-studio-routes-lifecycle-patch-block.test.ts
import { NextRequest } from 'next/server'

const mockCollection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mockCollection } }))
jest.mock('@/lib/api/platformAdmin', () => ({ canAccessOrg: () => true }))
jest.mock('@/lib/organizations/portal-modules', () => ({ isPortalModuleEnabled: () => true }))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: unknown, ctx: unknown) => unknown) =>
    (req: NextRequest, ctx: unknown) => handler(req, { uid: 'admin-1', role: 'admin' }, ctx),
}))
jest.mock('@/lib/auth/portal-middleware', () => ({
  withPortalAuthAndRole: (_minRole: string, handler: (req: NextRequest, uid: string, orgId: string, role: string, ctx: unknown) => unknown) =>
    (req: NextRequest, ctx: unknown) => handler(req, 'uid-1', 'org-1', 'owner', ctx),
}))

function stageProject() {
  const orgGet = jest.fn().mockResolvedValue({ exists: true, data: () => ({ settings: { portalModules: { bookStudio: true }, modulePolicies: { bookStudio: { actions: { edit: { owner: true } } } } } }) })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { doc: () => ({ get: orgGet }) }
    if (name === 'book_studio_projects') {
      return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ orgId: 'org-1', deleted: false }) }) }) }
    }
    throw new Error(`unexpected collection ${name}`)
  })
}

describe('admin PATCH /api/v1/book-studio/[resource]/[id] blocks direct lifecycleState writes', () => {
  beforeEach(() => { jest.clearAllMocks(); stageProject() })

  it('403s when lifecycleState is in the PATCH body', async () => {
    const { PATCH } = await import('@/lib/book-studio/routes').then((m) => m.createBookStudioRecordHandlers())
    const req = new NextRequest('http://localhost/api/v1/book-studio/projects/proj-1?orgId=org-1', {
      method: 'PATCH',
      body: JSON.stringify({ lifecycleState: 'live' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ resource: 'projects', id: 'proj-1' }) })
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.success).toBe(false)
  })
})

describe('portal PATCH /api/v1/portal/book-studio/[resource]/[id] blocks direct lifecycleState writes', () => {
  beforeEach(() => { jest.clearAllMocks(); stageProject() })

  it('403s when lifecycleState is in the PATCH body', async () => {
    const { PATCH } = await import('@/app/api/v1/portal/book-studio/[resource]/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/portal/book-studio/projects/proj-1', {
      method: 'PATCH',
      body: JSON.stringify({ lifecycleState: 'live' }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ resource: 'projects', id: 'proj-1' }) })
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/api/book-studio-routes-lifecycle-patch-block.test.ts`
Expected: FAIL (currently 200s since `lifecycleState` just passes through
`sanitizeBookStudioRecordPatch`'s whitelist filter and is silently dropped —
verify the current behavior is "silently ignored", not literally a 403,
before assuming this test already passes).

- [ ] **Step 3: Implement** both edits described above in `lib/book-studio/routes.ts` and `app/api/v1/portal/book-studio/[resource]/[id]/route.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api/book-studio-routes-lifecycle-patch-block.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full existing Book Studio route test suite to check for regressions**

Run: `npx jest __tests__/api/portal-book-studio-request-draft.test.ts __tests__/app/book-studio-project-workspace.test.tsx __tests__/app/book-studio-chapter-editor.test.tsx`
Expected: PASS (no regressions from the new blocked-field check).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 7: Commit**

```bash
git add lib/book-studio/routes.ts app/api/v1/portal/book-studio/[resource]/[id]/route.ts \
        __tests__/api/book-studio-routes-lifecycle-patch-block.test.ts
git commit -m "feat(book-studio): 403 direct PATCH writes to lifecycleState"
```

---

## Task 6: Gate assembly on lifecycle state (parallel-safe with Task 4/5/7 — depends only on Task 1)

**Files:**
- Modify: `app/api/v1/book-studio/projects/[id]/assemble/route.ts`
- Test: `__tests__/api/book-studio-assemble-lifecycle-gate.test.ts` (new)

**Design:** Insert an `assertMinState` check right after the project is
confirmed to belong to the org (before calling `assembleBookProject`), so
assembly refuses to run unless `lifecycleState >= 'rights_cleared'`. Note the
existing route does not currently fetch the project doc itself —
`assembleBookProject` does that internally. To check `assertMinState` before
calling assembly, fetch the project doc directly in the route.

```ts
// app/api/v1/book-studio/projects/[id]/assemble/route.ts — modify
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { ensureBookStudioAccess } from '@/lib/book-studio/api'
import { assertMinState, LifecycleStateTooLowError } from '@/lib/book-studio/lifecycle'
import {
  assembleBookProject,
  AssemblyNotFoundError,
  AssemblyNotReadyError,
  AssemblyValidationError,
} from '@/lib/book-studio/assembly/assemble'
import { AssemblyMissingAssetError } from '@/lib/book-studio/assembly/interior-pdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req: NextRequest, user, context: RouteContext) => {
  const { id: projectId } = await context.params

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const access = await ensureBookStudioAccess(req, user, body, 'write')
  if (access.error) return access.error
  const orgId = access.orgId

  const projectSnap = await adminDb.collection('book_studio_projects').doc(projectId).get()
  if (!projectSnap.exists) return apiError('book project not found', 404)
  const project = projectSnap.data() ?? {}
  if (project.orgId !== orgId || project.deleted === true) return apiError('book project not found', 404)

  try {
    assertMinState(project, 'rights_cleared')
  } catch (error) {
    if (error instanceof LifecycleStateTooLowError) {
      return apiError(error.message, 422, { blockers: error.blockers })
    }
    throw error
  }

  try {
    const manifest = await assembleBookProject({ projectId, orgId, actor: user })
    return apiSuccess({ manifest })
  } catch (error) {
    if (error instanceof AssemblyNotFoundError) {
      return apiError('book project not found', 404)
    }
    if (error instanceof AssemblyValidationError) {
      return apiError(error.message, 400)
    }
    if (error instanceof AssemblyMissingAssetError) {
      return apiError('pages are missing required image assets', 422, { missing: error.orders })
    }
    if (error instanceof AssemblyNotReadyError) {
      return apiError(error.message, 422)
    }
    throw error
  }
})
```

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/api/book-studio-assemble-lifecycle-gate.test.ts
import { NextRequest } from 'next/server'

const mockCollection = jest.fn()
const mockAssemble = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mockCollection } }))
jest.mock('@/lib/api/platformAdmin', () => ({ canAccessOrg: () => true }))
jest.mock('@/lib/organizations/portal-modules', () => ({ isPortalModuleEnabled: () => true }))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: unknown, ctx: unknown) => unknown) =>
    (req: NextRequest, ctx: unknown) => handler(req, { uid: 'admin-1', role: 'admin' }, ctx),
}))
jest.mock('@/lib/book-studio/assembly/assemble', () => ({
  assembleBookProject: (...args: unknown[]) => mockAssemble(...args),
  AssemblyNotFoundError: class AssemblyNotFoundError extends Error {},
  AssemblyNotReadyError: class AssemblyNotReadyError extends Error {},
  AssemblyValidationError: class AssemblyValidationError extends Error {},
}))
jest.mock('@/lib/book-studio/assembly/interior-pdf', () => ({
  AssemblyMissingAssetError: class AssemblyMissingAssetError extends Error { orders: number[] = [] },
}))

function stageProject(project: Record<string, unknown> | null) {
  const orgGet = jest.fn().mockResolvedValue({ exists: true, data: () => ({ settings: { portalModules: { bookStudio: true } } }) })
  mockCollection.mockImplementation((name: string) => {
    if (name === 'organizations') return { doc: () => ({ get: orgGet }) }
    if (name === 'book_studio_projects') {
      return { doc: () => ({ get: async () => ({ exists: Boolean(project), data: () => project }) }) }
    }
    throw new Error(`unexpected collection ${name}`)
  })
}

function makeRequest() {
  return new NextRequest('http://localhost/api/v1/book-studio/projects/proj-1/assemble?orgId=org-1', { method: 'POST', body: '{}' })
}

describe('POST /api/v1/book-studio/projects/[id]/assemble lifecycle gate', () => {
  beforeEach(() => { jest.clearAllMocks() })

  it('422s with blockers when rights ledger is needs_review (below rights_cleared)', async () => {
    stageProject({ orgId: 'org-1', lifecycleState: 'content_complete', deleted: false })
    const { POST } = await import('@/app/api/v1/book-studio/projects/[id]/assemble/route')
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'proj-1' }) })
    const body = await res.json()
    expect(res.status).toBe(422)
    expect(body.success).toBe(false)
    expect(Array.isArray(body.blockers)).toBe(true)
    expect(mockAssemble).not.toHaveBeenCalled()
  })

  it('proceeds to assembleBookProject when lifecycleState is rights_cleared or later', async () => {
    stageProject({ orgId: 'org-1', lifecycleState: 'rights_cleared', deleted: false })
    mockAssemble.mockResolvedValue({ status: 'draft' })
    const { POST } = await import('@/app/api/v1/book-studio/projects/[id]/assemble/route')
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'proj-1' }) })
    expect(res.status).toBe(200)
    expect(mockAssemble).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-1', orgId: 'org-1' }))
  })

  it('422s a project with no lifecycleState at all (defaults to draft)', async () => {
    stageProject({ orgId: 'org-1', deleted: false })
    const { POST } = await import('@/app/api/v1/book-studio/projects/[id]/assemble/route')
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'proj-1' }) })
    expect(res.status).toBe(422)
    expect(mockAssemble).not.toHaveBeenCalled()
  })

  it('404s when the project does not exist', async () => {
    stageProject(null)
    const { POST } = await import('@/app/api/v1/book-studio/projects/[id]/assemble/route')
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'proj-1' }) })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api/book-studio-assemble-lifecycle-gate.test.ts`
Expected: FAIL — current route calls `assembleBookProject` unconditionally, so
the 422 tests fail (assemble gets called / no 422).

- [ ] **Step 3: Implement** the Design code above in `app/api/v1/book-studio/projects/[id]/assemble/route.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/api/book-studio-assemble-lifecycle-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Check for regressions in existing assemble-adjacent tests**

Run: `npx jest -t assemble`
Expected: PASS (search whole suite for any other assemble-route test files;
if `__tests__/api` has an existing assemble test, confirm it still passes
now that the route fetches the project doc directly).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 7: Commit**

```bash
git add app/api/v1/book-studio/projects/[id]/assemble/route.ts \
        __tests__/api/book-studio-assemble-lifecycle-gate.test.ts
git commit -m "feat(book-studio): refuse assembly below rights_cleared lifecycle state"
```

---

## Task 7: UI — lifecycle badge + transition actions on BookProjectHeader (parallel-safe with Task 4/5/6 — depends only on Task 1's type addition)

**Files:**
- Modify: `components/book-studio/project/types.ts` (add `lifecycleState?: string` to `BookProject`)
- Modify: `components/book-studio/project/BookProjectHeader.tsx`
- Test: create `__tests__/components/book-studio-project-header.test.tsx` (new — no header-specific test currently exists; the closest coverage is the integration test `__tests__/app/book-studio-project-workspace.test.tsx`, which renders the whole workspace, so add a focused component test here instead of further bloating that file)

**Design:** Add a `lifecycleState` `StatusPill` next to the existing
`status`/`stage` pills, plus a `LifecycleActions` sub-section listing the
allowed next transitions as buttons, calling a new
`onTransition(toState: string) => void` prop (wired up by the parent
workspace page in a later, non-Phase-1 pass — Phase 1 only requires the
component to expose the affordance and call the callback; the parent
component that fetches `TRANSITIONS` and calls the route is explicitly
out of scope for this plan per the "components...state badge + allowed
transition actions" file list, which does not list the workspace page
itself).

```tsx
// components/book-studio/project/types.ts — add to BookProject
export type BookProject = {
  id: string
  orgId: string
  title?: string
  status?: string
  stage?: string
  lifecycleState?: string
  format?: string
  trim?: BookProjectTrim
  stylePrompt?: string
  metadata?: BookProjectMetadata
  coverImageUrl?: string
  creativeCanvasId?: string
  seriesId?: string
  seriesVolumeNumber?: number
  packageManifest?: BookProjectManifest
}
```

```tsx
// components/book-studio/project/BookProjectHeader.tsx — full replacement
'use client'

import { PageHeader, StatusPill } from '@/components/ui/AppFoundation'
import { getBookFormat } from '@/lib/book-studio/format-registry'
import { humanizeToken, type BookProject } from './types'

// Mirrors lib/book-studio/lifecycle.ts TRANSITIONS — kept as a small local
// copy since this is a client component and lib/book-studio/lifecycle.ts
// pulls in firebase-admin/firestore (server-only) via executeLifecycleTransition.
// If lifecycle.ts is later split into a server-only file + a shared pure
// types/graph file, switch this back to importing TRANSITIONS directly.
const CLIENT_LIFECYCLE_TRANSITIONS: Record<string, string[]> = {
  draft: ['content_complete'],
  content_complete: ['rights_cleared', 'draft'],
  rights_cleared: ['assembled', 'draft'],
  assembled: ['qa_approved', 'draft'],
  qa_approved: ['submission_ready', 'draft'],
  submission_ready: ['submitted', 'draft'],
  submitted: ['live', 'draft'],
  live: ['archived', 'draft'],
  archived: ['draft'],
}

type BookProjectHeaderProps = {
  project: BookProject
  onOpenInCanvas: () => void
  openingCanvas: boolean
  onAssemble: () => void
  assembling: boolean
  showOperatorActions?: boolean
  onRequestDraft?: () => void
  requestingDraft?: boolean
  onTransition?: (toState: string) => void
  transitioning?: boolean
}

function statusTone(status?: string): 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'info' {
  if (status === 'approved') return 'success'
  if (status === 'blocked') return 'danger'
  if (status === 'internal_review' || status === 'client_review' || status === 'needs_review') return 'warn'
  return 'neutral'
}

function lifecycleTone(state: string): 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'info' {
  if (state === 'live') return 'success'
  if (state === 'archived') return 'neutral'
  if (state === 'draft') return 'neutral'
  return 'accent'
}

export function BookProjectHeader({
  project,
  onOpenInCanvas,
  openingCanvas,
  onAssemble,
  assembling,
  showOperatorActions = true,
  onRequestDraft,
  requestingDraft = false,
  onTransition,
  transitioning = false,
}: BookProjectHeaderProps) {
  const format = project.format ? getBookFormat(project.format) : null
  const trimLabel = project.trim?.presetId ? project.trim.presetId : format?.defaultTrim
  const lifecycleState = project.lifecycleState ?? 'draft'
  const allowedTransitions = CLIENT_LIFECYCLE_TRANSITIONS[lifecycleState] ?? []

  return (
    <PageHeader
      eyebrow="Book Studio · Project workspace"
      title={project.title ?? 'Untitled book project'}
      meta={
        <div className="flex flex-wrap items-center gap-2">
          {project.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={project.coverImageUrl}
              alt="Cover thumbnail"
              className="h-10 w-8 rounded-md border border-[var(--color-pib-border)] object-cover"
            />
          ) : null}
          {format ? <StatusPill tone="neutral">{format.label}</StatusPill> : null}
          {trimLabel ? <StatusPill tone="neutral">{trimLabel}</StatusPill> : null}
          <StatusPill tone={lifecycleTone(lifecycleState)}>{humanizeToken(lifecycleState)}</StatusPill>
          {project.status ? <StatusPill tone={statusTone(project.status)}>{humanizeToken(project.status)}</StatusPill> : null}
          {project.stage ? <StatusPill tone="neutral">{humanizeToken(project.stage)}</StatusPill> : null}
          {project.seriesVolumeNumber ? (
            <StatusPill tone="accent">Volume {project.seriesVolumeNumber}</StatusPill>
          ) : null}
          {project.creativeCanvasId ? (
            <a
              href={`/admin/creative-canvas?canvas=${encodeURIComponent(project.creativeCanvasId)}`}
              className="pib-pill"
            >
              Canvas ↗
            </a>
          ) : null}
        </div>
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {showOperatorActions ? (
            <>
              <button type="button" className="btn-secondary" disabled={openingCanvas} onClick={onOpenInCanvas}>
                {openingCanvas ? 'Opening…' : 'Open in canvas'}
              </button>
              <button type="button" className="btn-primary" disabled={assembling} onClick={onAssemble}>
                {assembling ? 'Assembling…' : 'Assemble book'}
              </button>
            </>
          ) : onRequestDraft ? (
            <button type="button" className="btn-primary" disabled={requestingDraft} onClick={onRequestDraft}>
              {requestingDraft ? 'Requesting…' : 'Request AI draft'}
            </button>
          ) : null}
          {onTransition
            ? allowedTransitions.map((toState) => (
                <button
                  key={toState}
                  type="button"
                  className="btn-secondary"
                  disabled={transitioning}
                  onClick={() => onTransition(toState)}
                >
                  {transitioning ? 'Working…' : `Move to ${humanizeToken(toState)}`}
                </button>
              ))
            : null}
        </div>
      }
    />
  )
}
```

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/book-studio-project-header.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { BookProjectHeader } from '@/components/book-studio/project/BookProjectHeader'
import type { BookProject } from '@/components/book-studio/project/types'

const baseProject: BookProject = { id: 'proj-1', orgId: 'org-1', title: 'My Book' }

describe('BookProjectHeader lifecycle UI', () => {
  it('shows "draft" as the lifecycle pill when lifecycleState is missing', () => {
    render(
      <BookProjectHeader
        project={baseProject}
        onOpenInCanvas={jest.fn()}
        openingCanvas={false}
        onAssemble={jest.fn()}
        assembling={false}
      />
    )
    expect(screen.getByText('draft')).toBeInTheDocument()
  })

  it('shows the stored lifecycleState as a pill', () => {
    render(
      <BookProjectHeader
        project={{ ...baseProject, lifecycleState: 'rights_cleared' }}
        onOpenInCanvas={jest.fn()}
        openingCanvas={false}
        onAssemble={jest.fn()}
        assembling={false}
      />
    )
    expect(screen.getByText('rights cleared')).toBeInTheDocument()
  })

  it('renders a button per allowed forward/reopen transition and calls onTransition with the target state', () => {
    const onTransition = jest.fn()
    render(
      <BookProjectHeader
        project={{ ...baseProject, lifecycleState: 'content_complete' }}
        onOpenInCanvas={jest.fn()}
        openingCanvas={false}
        onAssemble={jest.fn()}
        assembling={false}
        onTransition={onTransition}
      />
    )
    expect(screen.getByText('Move to rights cleared')).toBeInTheDocument()
    expect(screen.getByText('Move to draft')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Move to rights cleared'))
    expect(onTransition).toHaveBeenCalledWith('rights_cleared')
  })

  it('renders no transition buttons when onTransition is not provided', () => {
    render(
      <BookProjectHeader
        project={{ ...baseProject, lifecycleState: 'content_complete' }}
        onOpenInCanvas={jest.fn()}
        openingCanvas={false}
        onAssemble={jest.fn()}
        assembling={false}
      />
    )
    expect(screen.queryByText(/^Move to /)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/book-studio-project-header.test.tsx`
Expected: FAIL — no lifecycle pill/buttons rendered yet.

- [ ] **Step 3: Implement** the `types.ts` and `BookProjectHeader.tsx` changes above.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/book-studio-project-header.test.tsx`
Expected: PASS.

- [ ] **Step 5: Check the existing workspace integration test for regressions**

Run: `npx jest __tests__/app/book-studio-project-workspace.test.tsx`
Expected: PASS — this test renders `BookProjectHeader` without
`lifecycleState`/`onTransition` props; confirm it still passes with the
default-to-"draft" pill added. If it fails on an unexpected new pill text
match, adjust the test assertions there to tolerate the new pill (do not
remove the new pill — the integration test's assertions were written before
this pill existed).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 7: Commit**

```bash
git add components/book-studio/project/types.ts components/book-studio/project/BookProjectHeader.tsx \
        __tests__/components/book-studio-project-header.test.tsx
git commit -m "feat(book-studio): add lifecycle state badge and transition actions to project header"
```

---

## Task 8: Admin governance workspace — pipeline board by lifecycle state (parallel-safe with Task 4/5/6/7 — depends only on Task 1)

**Files:**
- Modify: `components/book-studio/AdminBookStudioGovernanceWorkspace.tsx`
- Test: create `__tests__/components/admin-book-studio-governance-pipeline.test.tsx` (new)

**Design:** Add a new self-contained `LifecyclePipelineBoard` sub-component
inside the same file (matching the file's existing pattern of colocated
small components/constants) that takes a list of projects (already-fetched
by the parent — this task does NOT add a new data-fetching hook; it exposes
a presentational component so the actual admin projects list page can wire
it up in a follow-up pass, consistent with how `BOOK_STUDIO_PERMISSION_ROWS`
etc. are pure presentational constants in this file today) and groups them
into columns by `lifecycleState`, defaulting missing values to `'draft'`.

```tsx
// components/book-studio/AdminBookStudioGovernanceWorkspace.tsx — append near
// the other exported pieces, and add LIFECYCLE_PIPELINE_STATES + the new
// component + render it inside the existing default export's JSX.

const LIFECYCLE_PIPELINE_STATES = [
  'draft', 'content_complete', 'rights_cleared', 'assembled',
  'qa_approved', 'submission_ready', 'submitted', 'live', 'archived',
] as const

export type LifecyclePipelineProject = {
  id: string
  title?: string
  lifecycleState?: string
}

function groupProjectsByLifecycleState(
  projects: LifecyclePipelineProject[],
): Record<(typeof LIFECYCLE_PIPELINE_STATES)[number], LifecyclePipelineProject[]> {
  const grouped = Object.fromEntries(
    LIFECYCLE_PIPELINE_STATES.map((state) => [state, [] as LifecyclePipelineProject[]]),
  ) as Record<(typeof LIFECYCLE_PIPELINE_STATES)[number], LifecyclePipelineProject[]>
  projects.forEach((project) => {
    const state = LIFECYCLE_PIPELINE_STATES.includes(project.lifecycleState as (typeof LIFECYCLE_PIPELINE_STATES)[number])
      ? (project.lifecycleState as (typeof LIFECYCLE_PIPELINE_STATES)[number])
      : 'draft'
    grouped[state].push(project)
  })
  return grouped
}

function lifecycleStateLabel(state: string): string {
  return state.replace(/_/g, ' ')
}

export function LifecyclePipelineBoard({ projects }: { projects: LifecyclePipelineProject[] }) {
  const grouped = groupProjectsByLifecycleState(projects)
  return (
    <Surface className="p-4">
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-pib-text-secondary)]">
        Pipeline by lifecycle state
      </h3>
      <div className="grid grid-cols-1 gap-3 overflow-x-auto sm:grid-cols-3 lg:grid-cols-9">
        {LIFECYCLE_PIPELINE_STATES.map((state) => (
          <div key={state} data-testid={`lifecycle-column-${state}`} className="min-w-[140px] rounded-md border border-[var(--color-pib-border)] p-2">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-pib-text-secondary)]">
              {lifecycleStateLabel(state)} ({grouped[state].length})
            </div>
            <ul className="space-y-1">
              {grouped[state].map((project) => (
                <li key={project.id} className="truncate text-sm">{project.title ?? 'Untitled book project'}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Surface>
  )
}
```

Then, inside `AdminBookStudioGovernanceWorkspace`'s returned JSX (find the
existing top-level `<div>`/`<>` wrapper returned by the component — read the
file's current render section past line 80 before editing, since the exact
JSX after `removeTemplate` was not captured verbatim in this plan's research
pass and must be re-read at implementation time to avoid clobbering
surrounding markup), add:

```tsx
<LifecyclePipelineBoard projects={[]} />
```

as a new section (wired to real data is out of scope for Phase 1 per the
same reasoning as Task 7 — the spec only requires "pipeline board by state"
to exist as a UI surface; the projects list data-fetching hook is a natural
Phase 1.5/2 follow-up, not blocking this acceptance criteria set).

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/admin-book-studio-governance-pipeline.test.tsx
import { render, screen } from '@testing-library/react'
import { LifecyclePipelineBoard, type LifecyclePipelineProject } from '@/components/book-studio/AdminBookStudioGovernanceWorkspace'

describe('LifecyclePipelineBoard', () => {
  it('renders a column per lifecycle state with correct counts', () => {
    const projects: LifecyclePipelineProject[] = [
      { id: 'p1', title: 'Book One', lifecycleState: 'draft' },
      { id: 'p2', title: 'Book Two', lifecycleState: 'rights_cleared' },
      { id: 'p3', title: 'Book Three' }, // no lifecycleState -> defaults to draft
    ]
    render(<LifecyclePipelineBoard projects={projects} />)

    expect(screen.getByTestId('lifecycle-column-draft')).toHaveTextContent('draft (2)')
    expect(screen.getByTestId('lifecycle-column-rights_cleared')).toHaveTextContent('rights cleared (1)')
    expect(screen.getByTestId('lifecycle-column-live')).toHaveTextContent('live (0)')
    expect(screen.getByText('Book One')).toBeInTheDocument()
    expect(screen.getByText('Book Three')).toBeInTheDocument()
  })

  it('renders all 9 lifecycle columns even with zero projects', () => {
    render(<LifecyclePipelineBoard projects={[]} />)
    ;['draft', 'content_complete', 'rights_cleared', 'assembled', 'qa_approved', 'submission_ready', 'submitted', 'live', 'archived']
      .forEach((state) => expect(screen.getByTestId(`lifecycle-column-${state}`)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/admin-book-studio-governance-pipeline.test.tsx`
Expected: FAIL — `LifecyclePipelineBoard` is not exported yet.

- [ ] **Step 3: Implement** — read the current full render body of
`components/book-studio/AdminBookStudioGovernanceWorkspace.tsx` past line 80
first, then add the Design code (constants, `groupProjectsByLifecycleState`,
`lifecycleStateLabel`, exported `LifecyclePipelineBoard`) plus a single
`<LifecyclePipelineBoard projects={[]} />` render call inside the existing
component's JSX without disturbing existing sections.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/admin-book-studio-governance-pipeline.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add components/book-studio/AdminBookStudioGovernanceWorkspace.tsx \
        __tests__/components/admin-book-studio-governance-pipeline.test.tsx
git commit -m "feat(book-studio): add lifecycle pipeline board to admin governance workspace"
```

---

## Parallelization summary

- **Sequential spine (must land in order, one agent or serialized):** Task 1
  → Task 2 → Task 3. All three touch the same file
  (`lib/book-studio/lifecycle.ts`) and each depends on the previous task's
  exports.
- **Parallel-safe once Task 3 is merged to `development`:** Tasks 4, 5, 6, 7,
  8 touch disjoint file sets (transition routes; existing PATCH routes;
  assemble route; BookProjectHeader + types; governance workspace) and can be
  dispatched to five parallel subagents. Task 4 itself can be split further
  into two parallel sub-tasks (admin route vs portal route) since they are
  separate files with separate tests.
- Every task ends with `npm run typecheck` — do not skip it even though it
  repeats per task; catching a cross-file type break early (e.g. Task 7's
  `BookProject.lifecycleState` vs Task 1's `BookLifecycleState`) is cheaper
  than discovering it at final verification.

---

## Final verification (run after all 8 tasks are merged to `development`)

- [ ] **Run the full lifecycle-related test files together**

```bash
npx jest \
  __tests__/lib/book-studio-lifecycle.test.ts \
  __tests__/api/book-studio-transition-admin.test.ts \
  __tests__/api/book-studio-transition-portal.test.ts \
  __tests__/api/book-studio-routes-lifecycle-patch-block.test.ts \
  __tests__/api/book-studio-assemble-lifecycle-gate.test.ts \
  __tests__/components/book-studio-project-header.test.tsx \
  __tests__/components/admin-book-studio-governance-pipeline.test.tsx
```

Expected: all suites PASS.

- [ ] **Run the full existing Book Studio test surface for regressions**

```bash
npx jest __tests__/api/portal-book-studio-request-draft.test.ts \
         __tests__/app/book-studio-project-workspace.test.tsx \
         __tests__/app/book-studio-chapter-editor.test.tsx
```

Expected: PASS, no regressions from the new PATCH block or assemble gate.

- [ ] **Run the entire Jest suite**

```bash
npm test
```

Expected: green, zero failures, zero new skipped tests.

- [ ] **Typecheck the whole project**

```bash
npm run typecheck
```

Expected: zero errors. (Per project memory: `next build` does not catch type
errors due to `ignoreBuildErrors`; `npm run typecheck` via
`tsconfig.typecheck.json` is the real gate — do not substitute a `next
build` run for this step.)

- [ ] **Verify each literal acceptance criterion from the V2 spec**

  1. "Cannot assemble with rights ledger `needs_review` → 422 listing the
     blocker." — covered by
     `__tests__/api/book-studio-assemble-lifecycle-gate.test.ts` ("422s with
     blockers when rights ledger is needs_review").
  2. "Transition endpoint enforces allow-list + guards; direct PATCH of
     `lifecycleState` is 403." — covered by
     `__tests__/api/book-studio-transition-admin.test.ts` ("400s on a
     disallowed skip-ahead transition") and
     `__tests__/api/book-studio-routes-lifecycle-patch-block.test.ts` (both
     403 cases).
  3. "Existing projects with no `lifecycleState` are treated as `draft`
     (migration-free default)." — covered by
     `resolveLifecycleState`/`assertMinState` tests in
     `__tests__/lib/book-studio-lifecycle.test.ts` and the assemble-gate
     test "422s a project with no lifecycleState at all".
  4. "Portal role without `canApprovalGates` cannot transition past
     `content_complete`." — covered by
     `__tests__/api/book-studio-transition-portal.test.ts` ("403s a member
     without canApprovalGates trying to reach rights_cleared").
  5. "Full jest suite + typecheck green." — covered by the two verification
     steps above.

- [ ] **Manual smoke check (optional but recommended before declaring Phase 1 done)**

  1. Start the dev server: `npm run dev` (or use the `run` skill).
  2. In the admin app, open an existing Book Studio project that has no
     `lifecycleState` field in Firestore — confirm the header pill reads
     "draft".
  3. `curl` or use the browser devtools network tab to `POST
     /api/v1/book-studio/projects/{id}/transition` with `{"toState":
     "content_complete"}` for a project with un-edited chapters — confirm a
     422 with a `blockers` array naming the specific chapter/page indices.
  4. Edit/approve all chapters and pages for that project, retry the same
     transition — confirm 200 and the pill updates to "content complete"
     after a refetch.
  5. Attempt `PATCH /api/v1/book-studio/projects/{id}` (the generic resource
     route) with `{"lifecycleState": "live"}` directly — confirm 403.
  6. Attempt `POST /api/v1/book-studio/projects/{id}/assemble` on a project
     still at `content_complete` — confirm 422 with a rights-ledger blocker
     message, and that no package manifest gets written.

- [ ] **Push to `origin/development`**

```bash
git push origin development
```

(Per project-wide git preflight rules: `development` is the only working
branch, no worktrees, no feature branches. Do not run `vercel --prod` or
promote to `main` — that requires Peet's explicit approval.)
