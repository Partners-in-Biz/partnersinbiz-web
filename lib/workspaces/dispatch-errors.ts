export type WorkspaceDispatchFailureCode =
  | 'dispatch_unavailable'
  | 'dispatch_rejected'
  | 'dispatch_invalid_response'
  | 'workspace_not_found'
  | 'workspace_manifest_invalid'
  | 'workspace_directory_outside_root'
  | 'workspace_directory_mismatch'
  | 'runtime_target_not_found'
  | 'runtime_target_disabled'
  | 'runtime_target_stale'
  | 'runtime_target_invalid_id'
  | 'linked_device_hermes_update_required'

export type SafeWorkspaceDispatchError = {
  code: WorkspaceDispatchFailureCode
  message: string
  retryable: boolean
}

const KNOWN_CODES = new Set<WorkspaceDispatchFailureCode>([
  'workspace_not_found', 'workspace_manifest_invalid', 'workspace_directory_outside_root',
  'workspace_directory_mismatch', 'runtime_target_not_found', 'runtime_target_disabled',
  'runtime_target_stale', 'runtime_target_invalid_id', 'dispatch_unavailable',
  'dispatch_rejected', 'dispatch_invalid_response', 'linked_device_hermes_update_required',
])

const SAFE_MESSAGES: Record<WorkspaceDispatchFailureCode, string> = {
  dispatch_unavailable: 'Agent run could not be started on the gateway.',
  dispatch_rejected: 'The agent gateway rejected the run request.',
  dispatch_invalid_response: 'The agent gateway returned an invalid run response.',
  workspace_not_found: 'The selected workspace is unavailable.',
  workspace_manifest_invalid: 'The selected workspace configuration is invalid.',
  workspace_directory_outside_root: 'The selected workspace directory is unavailable or not authorized.',
  workspace_directory_mismatch: 'The selected workspace directory is unavailable or not authorized.',
  runtime_target_not_found: 'The selected runtime target is unavailable.',
  runtime_target_disabled: 'The selected runtime target is unavailable.',
  runtime_target_stale: 'The selected runtime target is unavailable.',
  runtime_target_invalid_id: 'The selected runtime target is invalid.',
  linked_device_hermes_update_required: 'Hermes on this computer is too old. It will update automatically when idle.',
}

export function classifyWorkspaceDispatchFailure(
  error: unknown,
  status?: number,
): SafeWorkspaceDispatchError {
  const candidate = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : ''
  const code: WorkspaceDispatchFailureCode = KNOWN_CODES.has(candidate as WorkspaceDispatchFailureCode)
    ? candidate as WorkspaceDispatchFailureCode
    : typeof status === 'number' && status >= 400 && status < 500
      ? 'dispatch_rejected'
      : 'dispatch_unavailable'
  return { code, message: SAFE_MESSAGES[code], retryable: code === 'dispatch_unavailable' }
}

const SAFE_METADATA_KEYS = new Set([
  'conversationId', 'messageId', 'orgId', 'workspaceId', 'projectId', 'workspacePathClass',
  'requestedRuntimeTargetId', 'runtimeTargetId', 'runtimeKind', 'runtimeMachineLabel',
  'dispatchAgentId', 'model', 'provider', 'requestedAgentIds', 'orchestrationMode', 'source',
  'agentEffort', 'slashCommand', 'promptProfile',
  // Subagent branch completion (hermes-features-delegation → cron re-entry)
  'delegationId', 'childId', 'branchMessageId', 'parentRunHint',
  // Compact token ledger only (never raw prompt text) — see compactPromptLedger
  'contextLedger',
])

const SAFE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:@+ -]{0,199}$/
const SAFE_LEDGER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const SAFE_OMISSION_REASON = new Set(['empty', 'duplicate', 'budget'])

function finiteNonNegInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.min(Math.round(value), 50_000_000)
}

/**
 * Strip a prompt-budget ledger down to ids + token counts only.
 * Never persist raw block content / prompt text on hermes_runs.
 */
export function compactPromptLedger(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const row = input as Record<string, unknown>
  const profile = typeof row.profile === 'string' && SAFE_VALUE.test(row.profile) ? row.profile : undefined
  const limitTokens = finiteNonNegInt(row.limitTokens)
  const inputTokens = finiteNonNegInt(row.inputTokens)
  const blocks = Array.isArray(row.blocks)
    ? row.blocks.slice(0, 40).flatMap((block) => {
      if (!block || typeof block !== 'object' || Array.isArray(block)) return []
      const b = block as Record<string, unknown>
      const id = typeof b.id === 'string' && SAFE_LEDGER_ID.test(b.id) ? b.id : null
      if (!id) return []
      const blockInput = finiteNonNegInt(b.inputTokens)
      const includedTokens = finiteNonNegInt(b.includedTokens)
      const capTokens = finiteNonNegInt(b.capTokens)
      return [{
        id,
        ...(blockInput !== null ? { inputTokens: blockInput } : {}),
        ...(includedTokens !== null ? { includedTokens } : {}),
        included: b.included === true,
        ...(capTokens !== null ? { capTokens } : {}),
      }]
    })
    : []
  const omitted = Array.isArray(row.omitted)
    ? row.omitted.slice(0, 40).flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const o = item as Record<string, unknown>
      const id = typeof o.id === 'string' && SAFE_LEDGER_ID.test(o.id) ? o.id : null
      const reason = typeof o.reason === 'string' && SAFE_OMISSION_REASON.has(o.reason) ? o.reason : null
      if (!id || !reason) return []
      const omitTokens = finiteNonNegInt(o.inputTokens)
      return [{ id, reason, ...(omitTokens !== null ? { inputTokens: omitTokens } : {}) }]
    })
    : []
  if (!profile && limitTokens === null && inputTokens === null && blocks.length === 0 && omitted.length === 0) {
    return null
  }
  return {
    ...(profile ? { profile } : {}),
    ...(limitTokens !== null ? { limitTokens } : {}),
    ...(inputTokens !== null ? { inputTokens } : {}),
    blocks,
    omitted,
  }
}

export function sanitizeDispatchMetadata(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!SAFE_METADATA_KEYS.has(key)) continue
    if (key === 'contextLedger') {
      const compact = compactPromptLedger(value)
      if (compact) output.contextLedger = compact
      continue
    }
    if (typeof value === 'string' && SAFE_VALUE.test(value)) output[key] = value
    else if (Array.isArray(value)) {
      output[key] = value.filter((item): item is string => typeof item === 'string' && SAFE_VALUE.test(item)).slice(0, 50)
    }
  }
  return output
}

export type SafeRuntimeExecutionReceipt = {
  deviceId: string; runtimeTargetId: string; credentialVersion: number; mappingId: string; runtimeVersion: string
  acceptedAt: string; toolStartedAt: string; outcome: 'accepted' | 'started'; runId: string; requestId: string; signature: string
}
export type SafeHermesRunPayload = { runId?: string; status?: string; executionReceipt?: SafeRuntimeExecutionReceipt }

export const SAFE_HERMES_LIFECYCLE_STATUSES = [
  'queued', 'submitted', 'started', 'running', 'waiting_for_approval', 'approval_required',
  'completed', 'failed', 'cancelled', 'canceled', 'stopped', 'interrupted',
] as const

export type SafeHermesLifecycleStatus = typeof SAFE_HERMES_LIFECYCLE_STATUSES[number]
const SAFE_STATUS_SET = new Set<string>(SAFE_HERMES_LIFECYCLE_STATUSES)

export function isSafeHermesLifecycleStatus(value: unknown): value is SafeHermesLifecycleStatus {
  return typeof value === 'string' && SAFE_STATUS_SET.has(value)
}

export function safeHermesRunPayload(input: unknown): SafeHermesRunPayload {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const payload = input as Record<string, unknown>
  const rawRunId = payload.run_id ?? payload.runId ?? payload.id
  const runId = typeof rawRunId === 'string' && SAFE_VALUE.test(rawRunId) ? rawRunId : undefined
  const status = isSafeHermesLifecycleStatus(payload.status) ? payload.status : undefined
  const rawReceipt = payload.execution_receipt ?? payload.executionReceipt
  let executionReceipt: SafeRuntimeExecutionReceipt | undefined
  if (rawReceipt && typeof rawReceipt === 'object' && !Array.isArray(rawReceipt)) {
    const row = rawReceipt as Record<string, unknown>
    const safeText = (value: unknown, max = 200) => typeof value === 'string' && value.length <= max && SAFE_VALUE.test(value) ? value : null
    const deviceId = safeText(row.deviceId)
    const runtimeTargetId = safeText(row.runtimeTargetId)
    const mappingId = safeText(row.mappingId)
    const runtimeVersion = safeText(row.runtimeVersion)
    const acceptedAt = typeof row.acceptedAt === 'string' && row.acceptedAt.length <= 40 ? row.acceptedAt : null
    const toolStartedAt = typeof row.toolStartedAt === 'string' && row.toolStartedAt.length <= 40 ? row.toolStartedAt : null
    const receiptRunId = safeText(row.runId)
    const requestId = safeText(row.requestId)
    const signature = typeof row.signature === 'string' && /^[A-Za-z0-9_-]{16,1024}$/.test(row.signature) ? row.signature : null
    const credentialVersion = typeof row.credentialVersion === 'number' && Number.isSafeInteger(row.credentialVersion) && row.credentialVersion > 0 ? row.credentialVersion : null
    const outcome = row.outcome === 'accepted' || row.outcome === 'started' ? row.outcome : null
    if (deviceId && runtimeTargetId && mappingId && runtimeVersion && acceptedAt && toolStartedAt && receiptRunId && requestId && signature && credentialVersion && outcome) {
      executionReceipt = { deviceId, runtimeTargetId, credentialVersion, mappingId, runtimeVersion, acceptedAt, toolStartedAt, outcome, runId: receiptRunId, requestId, signature }
    }
  }
  return { ...(runId ? { runId } : {}), ...(status ? { status } : {}), ...(executionReceipt ? { executionReceipt } : {}) }
}
