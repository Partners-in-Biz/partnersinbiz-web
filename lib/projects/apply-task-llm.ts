import type { ApiUser } from '@/lib/api/types'
import {
  ensurePersonalTaskCredentialsSynced,
  resolveTaskLlmCredentials,
  type TaskLlmResolution,
} from '@/lib/projects/task-llm'

/** Stamp resolved LLM credential fields onto a task create/update payload. */
export async function applyTaskLlmCredentialResolution(input: {
  orgId: string
  ownerUid: string
  user?: ApiUser
  taskFields: Record<string, unknown>
  /** When true, best-effort sync personal credentials to Hermes before returning. */
  syncPersonal?: boolean
  runtimeTargetId?: string | null
}): Promise<{ resolution: TaskLlmResolution; syncMessage?: string }> {
  const resolution = await resolveTaskLlmCredentials({
    orgId: input.orgId,
    ownerUid: input.ownerUid,
    requestedSource: input.taskFields.llmCredentialSource,
    requestedProvider: input.taskFields.agentProvider,
    agentModel: typeof input.taskFields.agentModel === 'string' ? input.taskFields.agentModel : null,
    memberAccessPolicy: input.user?.memberAccessPolicy,
    runtimeTargetId: input.runtimeTargetId,
  })

  input.taskFields.llmCredentialSource = resolution.llmCredentialSource
  input.taskFields.llmCredentialOwnerUid = resolution.llmCredentialOwnerUid
  input.taskFields.agentProvider = resolution.agentProvider
  input.taskFields.llmConnectionId = resolution.connectionId
  if (resolution.resolvedSource === 'personal') {
    input.taskFields.llmResolvedSource = 'personal'
  } else {
    input.taskFields.llmResolvedSource = 'org'
  }

  let syncMessage = resolution.warning
  if (input.syncPersonal !== false && resolution.personalConnectionId && resolution.resolvedSource === 'personal') {
    const sync = await ensurePersonalTaskCredentialsSynced(resolution.personalConnectionId)
    if (!sync.ok) {
      syncMessage = [syncMessage, sync.message].filter(Boolean).join(' ')
      // Fall back to org if personal sync failed so the watcher can still run.
      input.taskFields.llmResolvedSource = 'org'
      input.taskFields.llmCredentialSource = resolution.llmCredentialSource
    } else if (sync.message) {
      syncMessage = [syncMessage, sync.message].filter(Boolean).join(' ')
    }
  }

  return { resolution, syncMessage }
}
