import { FieldValue } from 'firebase-admin/firestore'
import type { BookLifecycleState } from './types'

export const LIFECYCLE_STATES: BookLifecycleState[] = [
  'draft', 'content_complete', 'rights_cleared', 'assembled',
  'qa_approved', 'submission_ready', 'submitted', 'live', 'archived',
]

export const DEFAULT_LIFECYCLE_STATE: BookLifecycleState = 'draft'

// Explicit allow-list. Forward moves follow the pipeline order; every
// non-archived state may also move back to 'draft' (reopen), which the
// transition route requires a `reason` for (enforced below, not here).
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
  return isValidLifecycleState(project?.lifecycleState) ? (project!.lifecycleState as BookLifecycleState) : DEFAULT_LIFECYCLE_STATE
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
  if (qaStatus === 'approved' || qaStatus === 'pass') {
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
