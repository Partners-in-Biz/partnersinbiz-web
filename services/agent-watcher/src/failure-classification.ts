/**
 * Bounded automatic-requeue classification for watcher/runtime failures.
 *
 * Consumes the live at-most-once dispatch contract:
 * - only requeue when acceptance is proven not-accepted (or never posted)
 * - never schedule a second POST after accepted/unknown acceptance
 * - never auto-requeue side-effect, approval, review, worktree, or dependency blockers
 */

export type DispatchAcceptance = 'accepted' | 'not-accepted' | 'unknown'

export type FailureClass =
  | 'session_storage_busy'
  | 'runner_timeout_no_evidence'
  | 'transient_queue_host'
  | 'dispatch_acceptance_unknown'
  | 'accepted_run_unresolved'
  | 'worktree_safety'
  | 'dependency_blocker'
  | 'approval_gate'
  | 'review_changes_requested'
  | 'side_effect_sensitive'
  | 'business_or_test_blocker'
  | 'terminal_retry_exhausted'
  | 'unknown_non_retryable'

export interface RetryPolicy {
  schemaVersion: 1
  maxAttempts: number
  delaysMs: readonly number[]
  attempt: number
  nextAttempt: number
  idempotentDispatchRequired: true
  usesAtMostOnceKey: true
}

export interface DurableFailureRecord {
  schemaVersion: 1
  class: FailureClass
  phase: string
  retryEligible: boolean
  retryCount: number
  maxRetries: number
  retryAt: string | null
  dispatchKey: string | null
  acceptance: DispatchAcceptance | null
  runId: string | null
  error: string
  operatorAction: string
  observedAt: string
  policy: RetryPolicy
}

export interface ClassificationTaskSnapshot {
  title?: string | null
  requiredCapability?: string | null
  labels?: string[] | null
  reviewStatus?: string | null
  approvalStatus?: string | null
  approvalGate?: string | { status?: string | null } | null
  requiresApproval?: boolean | null
  agentOutput?: unknown
  completionEvidence?: unknown
}

export interface ClassifyInput {
  error: string
  dispatchAcceptance?: DispatchAcceptance | null
  runId?: string | null
  output?: string | null
  priorRetryCount?: number
  now?: number
  phase?: string
  dispatchKey?: string | null
  task?: ClassificationTaskSnapshot
}

export type AutomaticRequeueDecision =
  | {
      action: 'requeue'
      class: FailureClass
      retryEligible: true
      nextRetryCount: number
      retryAt: string
      reason: string
      operatorAction: string
      summary: string
      record: DurableFailureRecord
    }
  | {
      action: 'block'
      class: FailureClass
      retryEligible: false
      reason: string
      operatorAction: string
      summary: string
      record: DurableFailureRecord
    }

export const MAX_TRANSIENT_RETRIES = 3
export const TRANSIENT_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const
export const GATEWAY_STORM_RETRY_DELAYS_MS = [5 * 60_000, 15 * 60_000, 30 * 60_000] as const

const TRANSIENT_HOST_PATTERNS = [
  /\bconnection error\b/i,
  /\bfetch failed\b/i,
  /\bsocket hang up\b/i,
  /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN)\b/i,
  /\b(?:429|502|503|504)\b/,
  /\brate limit(?:ed)?\b/i,
  /\bservice unavailable\b/i,
  /\bprovider (?:is )?(?:overloaded|temporarily unavailable)\b/i,
  /\bwas not found on the agent gateway\b/i,
  /\bautomatic credential sync will retry\b/i,
  /\bProvider authentication failed\b/i,
  /\bupstream unavailable\b/i,
  /\bqueue(?:d)? (?:host|capacity|full|unavailable)\b/i,
  /\bhost (?:unavailable|unreachable|offline)\b/i,
  /\bgateway_draining\b/i,
  /\baddress already in use\b/i,
]

const SESSION_STORAGE_BUSY_PATTERNS = [
  /\bsession[- ]?storage(?: is)? busy\b/i,
  /\bstorage(?: is)? busy\b/i,
  /\bdatabase is locked\b/i,
  /\bSQLITE_BUSY\b/i,
  /\bsession store(?: is)? (?:busy|locked)\b/i,
  /\bprofile (?:db|database|store)(?: is)? (?:busy|locked)\b/i,
]

const RUNNER_TIMEOUT_PATTERNS = [
  /\brunner timed? out\b/i,
  /\brun timed? out\b/i,
  /\bagent run timed? out\b/i,
  /\btimed? out after\b/i,
  /\btimeout(?: while| during)? (?:polling|waiting|running)\b/i,
  /\bdeadline exceeded\b/i,
]

const WORKTREE_SAFETY_PATTERNS = [
  /\bTASK_WORKTREE_BLOCKED\b/i,
  /\bshared_worktree_(?:dirty|branch_conflict)\b/i,
  /\btask_worktree_(?:dirty|conflict)\b/i,
  /\btask_branch_conflict\b/i,
  /\bworktree (?:is dirty|conflict|blocked)\b/i,
]

const DEPENDENCY_PATTERNS = [
  /\bdependenc(?:y|ies)\b/i,
  /\bdependsOn\b/i,
  /\bunresolved dependency\b/i,
  /\bwaiting (?:on|for) (?:upstream|dependency)\b/i,
]

const APPROVAL_PATTERNS = [
  /\bapproval(?: gate)?\b/i,
  /\brequires? approval\b/i,
  /\bawaiting approval\b/i,
]

const BUSINESS_OR_TEST_PATTERNS = [
  /\btest(?:s)? failed\b/i,
  /\bassertion failed\b/i,
  /\bbuild failed\b/i,
  /\btypecheck failed\b/i,
  /\blint failed\b/i,
  /\bbusiness blocker\b/i,
  /\bproduct blocker\b/i,
  /\bspec (?:mismatch|rejected)\b/i,
]

const SIDE_EFFECT_EVIDENCE_PATTERNS = [
  /\bcommit(?:ted|sha)?\b/i,
  /\bpushed to origin\b/i,
  /\bpublished\b/i,
  /\bsent (?:email|message|outreach)\b/i,
  /\binvoice\b/i,
  /\bpayment\b/i,
  /\bdeploy(?:ed|ment)\b/i,
  /\breleased to production\b/i,
]

const PRE_EXECUTION_FAILOVER_UNSAFE =
  /\b(approval|approve|send|message|publish|schedule|spend|finance|invoice|payment|delete|archive|secret|config|deploy|release|production|client-visible)\b/i
// Title text is noisier than capability/labels ("prompt budget", "config note").
const SIDE_EFFECT_TITLE_UNSAFE =
  /\b(publish|send(?:\s+email)?|invoice|payment|deploy(?:ment)?|production|client-visible|secret|delete|archive|finance|paid\s+spend|ad\s+spend)\b/i

const APPROVED_STATUSES = new Set(['approved', 'accepted', 'resolved'])

export function isTransientHermesError(error: string): boolean {
  const text = error || ''
  return (
    SESSION_STORAGE_BUSY_PATTERNS.some((p) => p.test(text))
    || RUNNER_TIMEOUT_PATTERNS.some((p) => p.test(text))
    || TRANSIENT_HOST_PATTERNS.some((p) => p.test(text))
  )
}

export function isGatewayRestartStormError(error: string): boolean {
  return (
    /\bwas not found on the agent gateway\b/i.test(error)
    || /\brun_not_found\b/i.test(error)
    || /\breturned 502 repeatedly while polling\b/i.test(error)
    || /\breturned 503 repeatedly while polling\b/i.test(error)
    || /\bgateway_draining\b/i.test(error)
    || /\baddress already in use\b/i.test(error)
  )
}

export function transientRetryAt(retryCount: number, now = Date.now(), error?: string): string {
  const table = error && isGatewayRestartStormError(error)
    ? GATEWAY_STORM_RETRY_DELAYS_MS
    : TRANSIENT_RETRY_DELAYS_MS
  const delay = table[Math.min(Math.max(0, retryCount), table.length - 1)]
  return new Date(now + delay).toISOString()
}

function normalizeReviewStatus(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function getApprovalStatus(task: ClassificationTaskSnapshot | undefined): string | null {
  if (!task) return null
  const direct = typeof task.approvalStatus === 'string' ? task.approvalStatus.trim().toLowerCase() : ''
  if (direct) return direct
  const gate = typeof task.approvalGate === 'object' && typeof task.approvalGate?.status === 'string'
    ? task.approvalGate.status.trim().toLowerCase()
    : ''
  return gate || null
}

export function hasPendingApprovalGate(task: ClassificationTaskSnapshot | undefined): boolean {
  if (!task) return false
  const status = getApprovalStatus(task)
  const persistedGate = typeof task.approvalGate === 'string' ? task.approvalGate.trim().toLowerCase() : ''
  if (persistedGate && persistedGate !== 'none') return status !== 'approved'
  if (task.requiresApproval === true) return !status || !APPROVED_STATUSES.has(status)
  if (!status) return false
  return !APPROVED_STATUSES.has(status)
}

export function isSideEffectSensitiveTask(task: ClassificationTaskSnapshot | undefined): boolean {
  if (!task) return false
  const capabilityAndLabels = [
    task.requiredCapability,
    ...(task.labels ?? []),
  ].filter(Boolean).join(' ')
  if (PRE_EXECUTION_FAILOVER_UNSAFE.test(capabilityAndLabels)) return true
  const title = typeof task.title === 'string' ? task.title : ''
  return SIDE_EFFECT_TITLE_UNSAFE.test(title)
}

function hasCommittedOrEvidencedOutput(input: {
  output?: string | null
  task?: ClassificationTaskSnapshot
}): boolean {
  if (input.task?.completionEvidence && typeof input.task.completionEvidence === 'object') return true
  const ao = input.task?.agentOutput
  if (ao && typeof ao === 'object') {
    const rec = ao as Record<string, unknown>
    if (Array.isArray(rec.artifacts) && rec.artifacts.length > 0) return true
    if (typeof rec.commit === 'string' && rec.commit.trim()) return true
    if (typeof rec.summary === 'string') {
      const summary = rec.summary
      if (summary.trim() && SIDE_EFFECT_EVIDENCE_PATTERNS.some((p) => p.test(summary))) return true
    }
  }
  const output = input.output || ''
  if (!output.trim()) return false
  if (SIDE_EFFECT_EVIDENCE_PATTERNS.some((p) => p.test(output))) return true
  if (/\b[0-9a-f]{7,40}\b/i.test(output) && /\bcommit\b/i.test(output)) return true
  return false
}

export function classifyFailureSignal(error: string, output?: string | null): FailureClass {
  const text = `${error || ''}\n${output || ''}`
  if (WORKTREE_SAFETY_PATTERNS.some((p) => p.test(text))) return 'worktree_safety'
  if (SESSION_STORAGE_BUSY_PATTERNS.some((p) => p.test(text))) return 'session_storage_busy'
  if (RUNNER_TIMEOUT_PATTERNS.some((p) => p.test(text))) return 'runner_timeout_no_evidence'
  if (DEPENDENCY_PATTERNS.some((p) => p.test(text)) && !TRANSIENT_HOST_PATTERNS.some((p) => p.test(text))) {
    return 'dependency_blocker'
  }
  if (APPROVAL_PATTERNS.some((p) => p.test(text)) && !TRANSIENT_HOST_PATTERNS.some((p) => p.test(text))) {
    return 'approval_gate'
  }
  if (BUSINESS_OR_TEST_PATTERNS.some((p) => p.test(text))) return 'business_or_test_blocker'
  if (TRANSIENT_HOST_PATTERNS.some((p) => p.test(text))) return 'transient_queue_host'
  return 'unknown_non_retryable'
}

function operatorActionFor(failureClass: FailureClass, dispatchKey: string | null): string {
  const keyHint = dispatchKey
    ? ` Reconcile Idempotency-Key ${dispatchKey} via GET /v1/runs/dispatch-key before any manual requeue.`
    : ' Confirm no accepted run exists before any manual requeue.'
  switch (failureClass) {
    case 'session_storage_busy':
      return `Wait for session-storage lock to clear, then unblock/requeue if still pending.${keyHint}`
    case 'runner_timeout_no_evidence':
      return `Confirm the runner produced no commits/artifacts, then unblock/requeue only if acceptance is not-accepted.${keyHint}`
    case 'transient_queue_host':
      return `Check Hermes/host health and queue capacity, then unblock/requeue after recovery.${keyHint}`
    case 'dispatch_acceptance_unknown':
      return `Do not create a new run. Reconcile the dispatch key first; only manual recovery after acceptance is proven absent.${keyHint}`
    case 'accepted_run_unresolved':
      return `Do not POST again. Reattach/poll the accepted run id or manually finish from its evidence.${keyHint}`
    case 'worktree_safety':
      return 'Resolve the shared/task worktree conflict manually. Never auto-stash/reset; then unblock when clean.'
    case 'dependency_blocker':
      return 'Resolve or approve upstream dependency tasks, then release this card.'
    case 'approval_gate':
      return 'Obtain the required human approval, then release the task. Automatic requeue is forbidden.'
    case 'review_changes_requested':
      return 'Address reviewer comments, then human-requeue. Automatic requeue is forbidden while changes are requested.'
    case 'side_effect_sensitive':
      return 'Side-effect-sensitive work cannot auto-retry. Operator must confirm no external action occurred, then manually requeue.'
    case 'business_or_test_blocker':
      return 'Fix the test/business failure evidence, then human-requeue.'
    case 'terminal_retry_exhausted':
      return `Retry budget exhausted.${keyHint} Inspect host/runtime, then human-unblock if safe.`
    default:
      return `Inspect the failure evidence and only human-requeue when safe.${keyHint}`
  }
}

function buildPolicy(priorRetryCount: number, error: string): RetryPolicy {
  const delays = isGatewayRestartStormError(error) ? GATEWAY_STORM_RETRY_DELAYS_MS : TRANSIENT_RETRY_DELAYS_MS
  return {
    schemaVersion: 1,
    maxAttempts: MAX_TRANSIENT_RETRIES,
    delaysMs: delays,
    attempt: Math.max(0, priorRetryCount),
    nextAttempt: Math.max(0, priorRetryCount) + 1,
    idempotentDispatchRequired: true,
    usesAtMostOnceKey: true,
  }
}

function buildRecord(input: {
  failureClass: FailureClass
  phase: string
  retryEligible: boolean
  priorRetryCount: number
  retryAt: string | null
  dispatchKey: string | null
  acceptance: DispatchAcceptance | null
  runId: string | null
  error: string
  operatorAction: string
  now: number
  policy: RetryPolicy
}): DurableFailureRecord {
  return {
    schemaVersion: 1,
    class: input.failureClass,
    phase: input.phase,
    retryEligible: input.retryEligible,
    retryCount: input.priorRetryCount,
    maxRetries: MAX_TRANSIENT_RETRIES,
    retryAt: input.retryAt,
    dispatchKey: input.dispatchKey,
    acceptance: input.acceptance,
    runId: input.runId,
    error: input.error,
    operatorAction: input.operatorAction,
    observedAt: new Date(input.now).toISOString(),
    policy: input.policy,
  }
}

/**
 * Central decision for automatic requeue. Safe-by-default: unknown classes block.
 */
export function decideAutomaticRequeue(input: ClassifyInput): AutomaticRequeueDecision {
  const priorRetryCount = Number.isFinite(input.priorRetryCount)
    ? Math.max(0, Math.trunc(Number(input.priorRetryCount)))
    : 0
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now()
  const acceptance = input.dispatchAcceptance ?? null
  const runId = input.runId ?? null
  const dispatchKey = input.dispatchKey ?? null
  const phase = input.phase || 'watcher-failure'
  const policy = buildPolicy(priorRetryCount, input.error)

  const finishBlock = (failureClass: FailureClass, reason: string): AutomaticRequeueDecision => {
    const operatorAction = operatorActionFor(failureClass, dispatchKey)
    const record = buildRecord({
      failureClass,
      phase,
      retryEligible: false,
      priorRetryCount,
      retryAt: null,
      dispatchKey,
      acceptance,
      runId,
      error: input.error,
      operatorAction,
      now,
      policy,
    })
    let summary = `Watcher error: ${input.error} Class=${failureClass}. ${operatorAction}`
    if (failureClass === 'dispatch_acceptance_unknown') {
      summary = `Watcher error: ${input.error} This task was not retried because dispatch acceptance is unknown; reconcile Idempotency-Key ${dispatchKey || '(missing)'} before any new dispatch.`
    } else if (failureClass === 'accepted_run_unresolved') {
      summary = runId
        ? `Watcher error after accepted run ${runId}: ${input.error} The watcher will not dispatch a second run; reconcile/poll the persisted run id instead.`
        : `Watcher error: ${input.error} The watcher will not dispatch a second run; reconcile/poll the persisted run id instead.`
    } else if (failureClass === 'side_effect_sensitive' || failureClass === 'approval_gate') {
      summary = `Pre-execution dispatch did not start and was not retried because this task is approval-gated or side-effect-sensitive. Exact transport evidence: ${input.error}`
    } else if (failureClass === 'terminal_retry_exhausted') {
      summary = `Watcher error: ${input.error} Automatic retry budget exhausted (${priorRetryCount}/${MAX_TRANSIENT_RETRIES}). Class=terminal_retry_exhausted. ${operatorAction}`
    } else if (failureClass === 'worktree_safety') {
      summary = `Watcher error: ${input.error} Class=worktree_safety. Automatic requeue forbidden. ${operatorAction}`
    } else if (failureClass === 'review_changes_requested') {
      summary = `Watcher error: ${input.error} Class=review_changes_requested. Automatic requeue forbidden while review changes are unresolved. ${operatorAction}`
    }
    return {
      action: 'block',
      class: failureClass,
      retryEligible: false,
      reason,
      operatorAction,
      summary,
      record,
    }
  }

  // At-most-once hard stops.
  if (acceptance === 'unknown') {
    return finishBlock(
      'dispatch_acceptance_unknown',
      'Dispatch acceptance is unknown; automatic requeue would risk a duplicate run.',
    )
  }
  if (acceptance === 'accepted' || (runId && acceptance !== 'not-accepted')) {
    return finishBlock(
      'accepted_run_unresolved',
      'An accepted run already exists; automatic requeue must not create a second POST.',
    )
  }

  // Task-level non-retryable guards.
  const reviewStatus = normalizeReviewStatus(input.task?.reviewStatus)
  if (reviewStatus === 'changes-requested' || reviewStatus === 'rejected') {
    return finishBlock(
      'review_changes_requested',
      'Unresolved review changes forbid automatic requeue.',
    )
  }
  if (hasPendingApprovalGate(input.task)) {
    return finishBlock('approval_gate', 'Pending approval gate forbids automatic requeue.')
  }
  if (isSideEffectSensitiveTask(input.task)) {
    return finishBlock(
      'side_effect_sensitive',
      'Side-effect-sensitive task forbids automatic requeue.',
    )
  }

  const rawSignal = classifyFailureSignal(input.error, input.output)
  const signal: FailureClass = rawSignal === 'runner_timeout_no_evidence' && hasCommittedOrEvidencedOutput(input) 
    ? 'business_or_test_blocker' 
    : rawSignal

  if (signal === 'business_or_test_blocker' && rawSignal === 'runner_timeout_no_evidence') {
    return finishBlock(
      'business_or_test_blocker',
      'Runner timeout retained committed/evidenced output; automatic requeue is unsafe.',
    )
  }
  if (signal === 'worktree_safety') {
    return finishBlock('worktree_safety', 'Worktree/safety conflict forbids automatic requeue.')
  }
  if (signal === 'dependency_blocker') {
    return finishBlock('dependency_blocker', 'Dependency blockers require human/upstream resolution.')
  }
  if (signal === 'approval_gate') {
    return finishBlock('approval_gate', 'Approval-related failure forbids automatic requeue.')
  }
  if (signal === 'business_or_test_blocker') {
    return finishBlock('business_or_test_blocker', 'Business/test blockers are not auto-retried.')
  }
  if (signal === 'unknown_non_retryable') {
    return finishBlock('unknown_non_retryable', 'Failure is not classified as a safe transient runtime fault.')
  }

  // Only these classes may auto-requeue, and only when acceptance is absent/not-accepted.
  const retriable = new Set<FailureClass>([
    'session_storage_busy',
    'runner_timeout_no_evidence',
    'transient_queue_host',
  ])
  if (!retriable.has(signal)) {
    return finishBlock(signal, 'Failure class is not eligible for automatic requeue.')
  }
  if (acceptance && acceptance !== 'not-accepted') {
    return finishBlock(
      'unknown_non_retryable',
      'Automatic requeue requires proven not-accepted dispatch acceptance.',
    )
  }

  if (priorRetryCount >= MAX_TRANSIENT_RETRIES) {
    return finishBlock(
      'terminal_retry_exhausted',
      `Automatic retry budget exhausted (${priorRetryCount}/${MAX_TRANSIENT_RETRIES}).`,
    )
  }

  const nextRetryCount = priorRetryCount + 1
  const retryAt = transientRetryAt(priorRetryCount, now, input.error)
  const operatorAction = operatorActionFor(signal, dispatchKey)
  const record = buildRecord({
    failureClass: signal,
    phase,
    retryEligible: true,
    priorRetryCount: nextRetryCount,
    retryAt,
    dispatchKey,
    acceptance,
    runId,
    error: input.error,
    operatorAction,
    now,
    policy: {
      ...policy,
      attempt: priorRetryCount,
      nextAttempt: nextRetryCount,
    },
  })

  return {
    action: 'requeue',
    class: signal,
    retryEligible: true,
    nextRetryCount,
    retryAt,
    reason: `Classified ${signal} as safe transient runtime failure under at-most-once contract.`,
    operatorAction,
    summary: `Transient watcher error: ${input.error} Automatic retry ${nextRetryCount}/${MAX_TRANSIENT_RETRIES} scheduled for ${retryAt}. Class=${signal}. Next attempt uses a fresh at-most-once dispatch key.`,
    record,
  }
}

/** Convenience matrix for docs/tests. */
export function classificationMatrix(): Array<{ signal: string; class: FailureClass; autoRequeue: boolean }> {
  return [
    { signal: 'session-storage busy / SQLITE_BUSY', class: 'session_storage_busy', autoRequeue: true },
    { signal: 'runner timeout with no evidenced output', class: 'runner_timeout_no_evidence', autoRequeue: true },
    { signal: '502/503/queue/host transport faults (not-accepted)', class: 'transient_queue_host', autoRequeue: true },
    { signal: 'dispatch acceptance unknown', class: 'dispatch_acceptance_unknown', autoRequeue: false },
    { signal: 'accepted run unresolved', class: 'accepted_run_unresolved', autoRequeue: false },
    { signal: 'worktree dirty/conflict', class: 'worktree_safety', autoRequeue: false },
    { signal: 'dependency/input blocker', class: 'dependency_blocker', autoRequeue: false },
    { signal: 'approval gate', class: 'approval_gate', autoRequeue: false },
    { signal: 'review changes-requested', class: 'review_changes_requested', autoRequeue: false },
    { signal: 'side-effect-sensitive task', class: 'side_effect_sensitive', autoRequeue: false },
    { signal: 'test/business blocker', class: 'business_or_test_blocker', autoRequeue: false },
    { signal: 'retry budget exhausted', class: 'terminal_retry_exhausted', autoRequeue: false },
  ]
}
