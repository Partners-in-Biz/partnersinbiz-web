/**
 * Chat project_task_proposal → durable Projects tasks.
 *
 * Hermes emits a proposal + "Create tasks" uiAction that was meant to resume the
 * same run. When the run has already completed, that resume fails with
 * "Agent action failed". Creating from the proposal payload on the platform
 * keeps the confirmation button working without requiring a live Hermes run.
 */

export type ProposalTaskSeed = {
  title: string
  description?: string
  assigneeAgentId?: string
  reviewerAgentId?: string
  dependencySequence: number[]
  requiredCapability?: string
  agentEffort?: string
  agentModel?: string
  riskLevel?: string
  labels?: string[]
}

export type ProjectTaskProposalPart = {
  type: 'project_task_proposal'
  title?: string
  projectId: string
  bundleId: string
  tasks: ProposalTaskSeed[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isCreateTasksUiAction(action: {
  id?: string
  actionId?: string
  label?: string
  type?: string
}): boolean {
  const type = String(action.type ?? '').toLowerCase()
  if (type !== 'custom' && type !== 'choose') return false
  const label = cleanString(action.label).toLowerCase()
  const actionId = cleanString(action.actionId || action.id).toLowerCase()
  if (label === 'create tasks' || label === 'create task') return true
  if (actionId === 'create-chain' || actionId === 'create_tasks' || actionId === 'create-tasks') return true
  if (actionId.includes('create-task') || actionId.includes('create_task')) return true
  return false
}

export function extractProjectTaskProposal(message: {
  richParts?: unknown[]
  rich_parts?: unknown[]
}): ProjectTaskProposalPart | null {
  const parts = Array.isArray(message.richParts)
    ? message.richParts
    : Array.isArray(message.rich_parts)
      ? message.rich_parts
      : []
  for (const raw of parts) {
    if (!isRecord(raw)) continue
    if (String(raw.type ?? '') !== 'project_task_proposal') continue
    const projectId = cleanString(raw.projectId)
    if (!projectId) continue
    const tasksRaw = Array.isArray(raw.tasks) ? raw.tasks : []
    const tasks: ProposalTaskSeed[] = []
    for (const task of tasksRaw) {
      if (!isRecord(task)) continue
      const title = cleanString(task.title)
      if (!title) continue
      const dependencySequence = Array.isArray(task.dependencySequence)
        ? task.dependencySequence
            .map((value) => (typeof value === 'number' && Number.isInteger(value) ? value : Number.NaN))
            .filter((value) => Number.isInteger(value) && value >= 0)
        : []
      const modelPolicy = cleanString(task.modelPolicy)
      const agentModel = cleanString(task.agentModel) || (modelPolicy && modelPolicy.toLowerCase() !== 'auto' ? modelPolicy : '')
      tasks.push({
        title,
        ...(cleanString(task.description) ? { description: cleanString(task.description) } : {}),
        ...(cleanString(task.assigneeAgentId) ? { assigneeAgentId: cleanString(task.assigneeAgentId) } : {}),
        ...(cleanString(task.reviewerAgentId) ? { reviewerAgentId: cleanString(task.reviewerAgentId) } : {}),
        dependencySequence,
        ...(cleanString(task.requiredCapability) ? { requiredCapability: cleanString(task.requiredCapability) } : {}),
        ...(cleanString(task.agentEffort) ? { agentEffort: cleanString(task.agentEffort) } : {}),
        ...(agentModel ? { agentModel } : {}),
        ...(cleanString(task.riskLevel) ? { riskLevel: cleanString(task.riskLevel) } : {}),
        ...(Array.isArray(task.labels)
          ? { labels: task.labels.map(cleanString).filter(Boolean) }
          : {}),
      })
    }
    if (tasks.length === 0) continue
    const bundleId = cleanString(raw.bundleId) || `${projectId}:proposal`
    return {
      type: 'project_task_proposal',
      ...(cleanString(raw.title) ? { title: cleanString(raw.title) } : {}),
      projectId,
      bundleId,
      tasks,
    }
  }
  return null
}

export function findPrecedingUserMessageId(
  messages: Array<{ id: string; role?: string; authorKind?: string }>,
  responseMessageId: string,
): string {
  const index = messages.findIndex((message) => message.id === responseMessageId)
  const start = index >= 0 ? index - 1 : messages.length - 1
  for (let i = start; i >= 0; i -= 1) {
    const row = messages[i]
    if (row.role === 'user' || row.authorKind === 'user') return row.id
  }
  return responseMessageId
}

export function buildTaskCreateBodiesFromProposal(input: {
  proposal: ProjectTaskProposalPart
  conversationId: string
  requestMessageId: string
  responseMessageId: string
  /** When creating sequentially, pass previously created task ids keyed by proposal sequence. */
  createdTaskIdsBySequence?: Record<number, string>
}): Array<Record<string, unknown>> {
  const { proposal, conversationId, requestMessageId, responseMessageId } = input
  const created = input.createdTaskIdsBySequence ?? {}
  return proposal.tasks.map((task, sequence) => {
    const dependsOn = task.dependencySequence
      .map((dep) => created[dep])
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    const body: Record<string, unknown> = {
      title: task.title,
      description: task.description ?? '',
      chatOrigin: {
        conversationId,
        requestMessageId,
        responseMessageId,
        bundleId: proposal.bundleId,
        sequence,
      },
      agentInput: {
        spec: task.description?.trim() || task.title,
        context: {
          source: 'project_task_proposal',
          proposalTitle: proposal.title ?? null,
          sequence,
        },
      },
    }
    if (task.assigneeAgentId) body.assigneeAgentId = task.assigneeAgentId
    if (task.reviewerAgentId) body.reviewerAgentId = task.reviewerAgentId
    if (dependsOn.length > 0) body.dependsOn = dependsOn
    if (task.requiredCapability) body.requiredCapability = task.requiredCapability
    if (task.agentEffort) body.agentEffort = task.agentEffort
    if (task.agentModel) body.agentModel = task.agentModel
    if (task.riskLevel) body.riskLevel = task.riskLevel
    if (task.labels?.length) body.labels = task.labels
    return body
  })
}

export type CreateProposedTasksResult = {
  createdTaskIds: string[]
  deduplicatedCount: number
  projectId: string
  bundleId: string
}

/**
 * Creates tasks from a chat proposal via the Projects API.
 * Idempotent per chatOrigin.bundleId + sequence (server-side dedupe).
 */
export async function createProposedTasksFromMessage(input: {
  orgId: string
  conversationId: string
  message: {
    id: string
    richParts?: unknown[]
    rich_parts?: unknown[]
  }
  messages: Array<{ id: string; role?: string; authorKind?: string }>
  fetchImpl?: typeof fetch
}): Promise<CreateProposedTasksResult> {
  const proposal = extractProjectTaskProposal(input.message)
  if (!proposal) {
    throw new Error('This message has no project task proposal to create.')
  }
  const requestMessageId = findPrecedingUserMessageId(input.messages, input.message.id)
  const fetchFn = input.fetchImpl ?? fetch
  const createdTaskIdsBySequence: Record<number, string> = {}
  const createdTaskIds: string[] = []
  let deduplicatedCount = 0

  for (let sequence = 0; sequence < proposal.tasks.length; sequence += 1) {
    const [taskBody] = buildTaskCreateBodiesFromProposal({
      proposal,
      conversationId: input.conversationId,
      requestMessageId,
      responseMessageId: input.message.id,
      createdTaskIdsBySequence,
    }).slice(sequence, sequence + 1)

    const response = await fetchFn(`/api/v1/projects/${encodeURIComponent(proposal.projectId)}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Org-Id': input.orgId,
      },
      body: JSON.stringify(taskBody ?? {}),
    })
    const payload = await response.json().catch(() => null) as {
      data?: { id?: string; deduplicated?: boolean }
      error?: string
    } | null
    if (!response.ok) {
      throw new Error(
        typeof payload?.error === 'string' && payload.error.trim()
          ? payload.error
          : `Failed to create task ${sequence + 1}: ${response.status}`,
      )
    }
    const taskId = typeof payload?.data?.id === 'string' ? payload.data.id : ''
    if (!taskId) throw new Error(`Task ${sequence + 1} was created without an id`)
    createdTaskIdsBySequence[sequence] = taskId
    createdTaskIds.push(taskId)
    if (payload?.data?.deduplicated) deduplicatedCount += 1
  }

  return {
    createdTaskIds,
    deduplicatedCount,
    projectId: proposal.projectId,
    bundleId: proposal.bundleId,
  }
}
