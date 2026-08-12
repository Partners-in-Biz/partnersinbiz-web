import { taskOrderMillis } from '@/lib/projects/taskPayload'

export const PROJECT_TASK_READ_MODEL_VERSION = 1

const READ_MODEL_FIELDS = [
  'title', 'columnId', 'order', 'priority', 'dueDate', 'endDate', 'completedAt',
  'agentStatus', 'assigneeAgentId', 'assigneeId', 'assigneeIds', 'reviewerAgentId',
  'reviewerIds', 'reviewStatus', 'approvalGateTaskId', 'approvalStatus',
  'agentReleaseStatus', 'dependsOn', 'labels', 'agentModel', 'agentConversationId',
  'attachments', 'createdAt', 'updatedAt', 'internalOnly', 'visibility',
  'allowedUserIds', 'allowedOrgIds', 'allowedRoleIds', 'allowedRoles', 'ownerUid',
  'createdBy', 'chatOrigin',
] as const

type ProjectTaskReadModelTask = { id: string; [key: string]: unknown }

function compactArtifacts(value: unknown) {
  if (!Array.isArray(value)) return undefined
  return value
    .filter((artifact): artifact is Record<string, unknown> => !!artifact && typeof artifact === 'object' && !Array.isArray(artifact))
    .map((artifact) => {
      const compact: Record<string, unknown> = {}
      for (const key of ['label', 'url', 'ref', 'type', 'name']) {
        if (artifact[key] !== undefined) compact[key] = artifact[key]
      }
      return compact
    })
}

/**
 * A deliberately small, server-side task projection. It is safe to repeat in
 * board and chat-progress polls: task descriptions, prompts, evidence, and
 * agent narrative output remain available only from the single-task endpoint.
 */
export function projectTaskReadModelTask(id: string, task: Record<string, unknown>): ProjectTaskReadModelTask {
  const compact: ProjectTaskReadModelTask = { id }
  for (const field of READ_MODEL_FIELDS) {
    if (task[field] !== undefined) compact[field] = task[field]
  }
  const artifacts = compactArtifacts((task.agentOutput as Record<string, unknown> | undefined)?.artifacts)
  if (artifacts && artifacts.length > 0) compact.agentOutput = { artifacts }
  return compact
}

export function buildProjectTaskReadModel(tasks: Array<{ id: string; [key: string]: unknown }>) {
  return {
    schemaVersion: PROJECT_TASK_READ_MODEL_VERSION,
    tasks: tasks
      .map((task) => projectTaskReadModelTask(task.id, task))
      .sort((left, right) => taskOrderMillis(left.order) - taskOrderMillis(right.order)),
  }
}

export function isProjectTaskReadModel(value: unknown): value is ReturnType<typeof buildProjectTaskReadModel> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.schemaVersion === PROJECT_TASK_READ_MODEL_VERSION && Array.isArray(record.tasks)
}
