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

export type SafeWorkspaceDispatchError = {
  code: WorkspaceDispatchFailureCode
  message: string
  retryable: boolean
}

const KNOWN_CODES = new Set<WorkspaceDispatchFailureCode>([
  'workspace_not_found', 'workspace_manifest_invalid', 'workspace_directory_outside_root',
  'workspace_directory_mismatch', 'runtime_target_not_found', 'runtime_target_disabled',
  'runtime_target_stale', 'runtime_target_invalid_id', 'dispatch_unavailable',
  'dispatch_rejected', 'dispatch_invalid_response',
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
  'agentEffort', 'slashCommand',
])

const SAFE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:@+ -]{0,199}$/

export function sanitizeDispatchMetadata(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!SAFE_METADATA_KEYS.has(key)) continue
    if (typeof value === 'string' && SAFE_VALUE.test(value)) output[key] = value
    else if (Array.isArray(value)) {
      output[key] = value.filter((item): item is string => typeof item === 'string' && SAFE_VALUE.test(item)).slice(0, 50)
    }
  }
  return output
}

export type SafeHermesRunPayload = { runId?: string; status?: string }

export function safeHermesRunPayload(input: unknown): SafeHermesRunPayload {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const payload = input as Record<string, unknown>
  const rawRunId = payload.run_id ?? payload.runId ?? payload.id
  const runId = typeof rawRunId === 'string' && SAFE_VALUE.test(rawRunId) ? rawRunId : undefined
  const status = typeof payload.status === 'string' && SAFE_VALUE.test(payload.status) ? payload.status : undefined
  return { ...(runId ? { runId } : {}), ...(status ? { status } : {}) }
}
