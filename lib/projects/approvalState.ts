/**
 * Canonical project-task state contract helpers for approval gates.
 *
 * Signals (independent; do not conflate):
 * - columnId: board column (todo | in_progress | review | done | blocked | backlog | …)
 * - agentStatus: agent runtime lifecycle (pending | picked-up | in-progress | done | …)
 * - reviewStatus: quality/reviewer verdict (pending | in-progress | approved | changes-requested)
 * - approvalStatus: human business approval for gated work (pending | approved | rejected | denied)
 *
 * Dependency eligibility for an approval-gate task requires approvalStatus=approved.
 * Board Done alone is not sufficient for gates. Ordinary (non-gate) tasks may resolve
 * dependents from columnId=done after explicit board acceptance.
 */

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'denied'

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function lower(value: unknown): string {
  return cleanString(value).toLowerCase()
}

export function hasApprovalGateMarker(
  data: Record<string, unknown>,
  nextBody: Record<string, unknown> = {},
): boolean {
  const labels = Array.isArray(data.labels)
    ? data.labels.map((label) => String(label).toLowerCase())
    : []
  const nextLabels = Array.isArray(nextBody.labels)
    ? nextBody.labels.filter((label): label is string => typeof label === 'string').map((l) => l.toLowerCase())
    : []
  const labelGate = [...labels, ...nextLabels].some((label) =>
    /^(approval-gate|approval-required|client-approval|required-approval)(:.*)?$/i.test(String(label || '').trim()),
  )
  const existingGate = typeof data.approvalGate === 'string' && data.approvalGate && data.approvalGate !== 'none'
  const nextGate = typeof nextBody.approvalGate === 'string' && nextBody.approvalGate && nextBody.approvalGate !== 'none'
  // Existing non-null approvalStatus marks a historical gate. A request body that
  // merely *attempts* to set approvalStatus does not — that would allow non-gate
  // tasks to become gates by writing the field alone.
  const existingApprovalStatus = typeof data.approvalStatus === 'string' && data.approvalStatus.trim().length > 0
  return Boolean(labelGate || existingGate || nextGate || existingApprovalStatus)
}

/**
 * Align approval-gate task fields so UI board state cannot diverge from
 * canonical approvalStatus. Idempotent for repeated approvals.
 */
export function reconcileApprovalGateUpdate(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>,
  body: Record<string, unknown>,
  isApprovalGate: boolean,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string; status: number } {
  if (!isApprovalGate) return { ok: true, value: updates }

  const next: Record<string, unknown> = { ...updates }

  const approval = lower(next.approvalStatus !== undefined ? next.approvalStatus : existing.approvalStatus)
  const column = lower(next.columnId !== undefined ? next.columnId : existing.columnId)

  // Explicit human approval — land the card in Done with aligned review/agent signals.
  if (body.approvalStatus !== undefined && approval === 'approved') {
    if (body.columnId === undefined) next.columnId = 'done'
    if (body.reviewStatus === undefined) next.reviewStatus = 'approved'
    if (body.agentStatus === undefined) next.agentStatus = 'done'
    return { ok: true, value: next }
  }

  // Explicit rejection — never leave as Done/approved.
  if (body.approvalStatus !== undefined && (approval === 'rejected' || approval === 'denied')) {
    if (body.columnId === undefined || column === 'done') next.columnId = body.columnId === undefined ? 'todo' : next.columnId
    if (column === 'done' && body.columnId === undefined) next.columnId = 'todo'
    if (body.reviewStatus === undefined) next.reviewStatus = 'changes-requested'
    if (body.agentStatus === undefined) next.agentStatus = 'pending'
    // Rejected + done is contradictory.
    if (lower(next.columnId) === 'done') {
      return {
        ok: false,
        error: 'approvalStatus=rejected|denied cannot be combined with columnId=done',
        status: 400,
      }
    }
    return { ok: true, value: next }
  }

  // Prevent Done without canonical approval on a required gate.
  // Dragging a gate card to Done, or setting agentStatus=done, is not approval.
  const finalApproval = lower(next.approvalStatus !== undefined ? next.approvalStatus : existing.approvalStatus)
  const finalColumn = lower(next.columnId !== undefined ? next.columnId : existing.columnId)
  const finalAgent = lower(next.agentStatus !== undefined ? next.agentStatus : existing.agentStatus)
  const finalReview = lower(next.reviewStatus !== undefined ? next.reviewStatus : existing.reviewStatus)

  if (finalColumn === 'done' && finalApproval !== 'approved') {
    return {
      ok: false,
      error: 'Approval-gate tasks cannot be columnId=done without approvalStatus=approved',
      status: 400,
    }
  }

  if (
    body.agentStatus === 'done'
    && finalAgent === 'done'
    && finalApproval !== 'approved'
  ) {
    return {
      ok: false,
      error: 'Approval-gate tasks cannot set agentStatus=done until approvalStatus=approved',
      status: 400,
    }
  }

  // Approved gates should not carry rejected review.
  if (finalApproval === 'approved' && finalReview === 'changes-requested' && body.reviewStatus === 'changes-requested') {
    return {
      ok: false,
      error: 'approvalStatus=approved cannot be combined with reviewStatus=changes-requested',
      status: 400,
    }
  }

  // Cancelled/rejected agent work should not stay approved.
  if (finalApproval === 'approved' && (body.status === 'cancelled' || body.status === 'canceled')) {
    return {
      ok: false,
      error: 'approvalStatus=approved cannot be combined with a cancelled task',
      status: 400,
    }
  }

  return { ok: true, value: next }
}

export function isCanonicalApprovalApproved(task: { approvalStatus?: unknown }): boolean {
  return lower(task.approvalStatus) === 'approved'
}
