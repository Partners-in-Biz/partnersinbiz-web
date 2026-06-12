/**
 * Firestore onSnapshot listener + dispatch coordinator.
 *
 * Subscribes to all tasks (collectionGroup) where assigneeAgentId is an enabled
 * agent and
 * agentStatus = 'pending'. For each added/modified doc, attempts to claim it and run
 * it on Hermes. In-flight task IDs are tracked so rapid snapshot updates don't double-process.
 *
 * Concurrency cap: 5 active dispatches per agent.
 */
import type { DocumentReference, DocumentSnapshot, QuerySnapshot } from 'firebase-admin/firestore'
import { db, FieldValue } from './firestore'
import { AGENT_IDS, getAgentConfig, loadEnabledAgentIds, type AgentId } from './config'
import { claimReviewTask, claimTask, startHeartbeat } from './claim'
import { runAndPoll, type TaskDispatchInput } from './hermes'
import { logger } from './logger'
import { agentStatusUpdate } from './task-updates'
import { getTaskDispatchBlocker, hasPendingApprovalGate, hasPendingScheduledRelease, isDependencyResolved, releaseMillis } from './eligibility'

const MAX_CONCURRENT_PER_AGENT = 5
const READY_TASK_SWEEP_MS = 60_000
const MAX_READY_SWEEP_DOCS = 100
const MAX_SCHEDULED_RELEASE_SWEEP_DOCS = 100
const MAX_DEPENDENCY_RELEASE_SWEEP_DOCS = 100

const inFlight = new Set<string>()
const perAgentInFlight = new Map<AgentId, number>()
const deferredByAgent = new Map<AgentId, Map<string, { ref: DocumentReference; data: TaskData }>>()
let activeAgentIds = new Set<string>(AGENT_IDS)
let scheduledReleaseSweepDisabled = false

function incAgent(agentId: AgentId): void {
  perAgentInFlight.set(agentId, (perAgentInFlight.get(agentId) ?? 0) + 1)
}
function decAgent(agentId: AgentId): void {
  const cur = perAgentInFlight.get(agentId) ?? 0
  perAgentInFlight.set(agentId, Math.max(0, cur - 1))
}

function currentAgentIds(): string[] {
  return Array.from(activeAgentIds).sort()
}

function isActiveAgentId(agentId: unknown): agentId is AgentId {
  return typeof agentId === 'string' && activeAgentIds.has(agentId)
}

function chunkAgentIds(agentIds: string[], size = 30): string[][] {
  const chunks: string[][] = []
  for (let index = 0; index < agentIds.length; index += size) {
    chunks.push(agentIds.slice(index, index + size))
  }
  return chunks.length > 0 ? chunks : [Array.from(AGENT_IDS)]
}

interface TaskData {
  orgId?: string
  projectId?: string
  assigneeAgentId?: string
  agentStatus?: string
  agentInput?: { spec?: string; context?: Record<string, unknown>; constraints?: string[] }
  dependsOn?: string[]
  title?: string
  columnId?: string
  reviewerAgentId?: string
  reviewStatus?: string
  agentOutput?: { summary?: string }
  status?: string
  deleted?: boolean
  requiresApproval?: boolean
  approvalStatus?: string
  approvalGate?: { status?: string }
  agentReleaseAt?: string | number | { toMillis?: () => number; toDate?: () => Date }
  agentReleaseStatus?: string
  agentReleasedAt?: unknown
  riskLevel?: string
  agentEffort?: string
  agentModel?: string
  requiredCapability?: string
  requestedByAgentId?: string
  expectedArtifacts?: string[]
}

function deferTask(agentId: AgentId, taskRef: DocumentReference, taskData: TaskData): void {
  const existing = deferredByAgent.get(agentId) ?? new Map<string, { ref: DocumentReference; data: TaskData }>()
  existing.set(taskRef.path, { ref: taskRef, data: taskData })
  deferredByAgent.set(agentId, existing)
  logger.info('task deferred — agent concurrency limit reached', { taskId: taskRef.id, agentId })
}

function drainDeferredTasks(agentId: AgentId): void {
  const queued = deferredByAgent.get(agentId)
  if (!queued || queued.size === 0) return

  while ((perAgentInFlight.get(agentId) ?? 0) < MAX_CONCURRENT_PER_AGENT && queued.size > 0) {
    const next = queued.entries().next().value as [string, { ref: DocumentReference; data: TaskData }] | undefined
    if (!next) break
    const [path, item] = next
    queued.delete(path)
    void dispatchTask(item.ref, item.data)
  }

  if (queued.size === 0) deferredByAgent.delete(agentId)
}

async function dependenciesResolved(
  taskRef: DocumentReference,
  deps: string[] | undefined,
): Promise<{ ok: boolean; blockers: string[] }> {
  if (!deps || deps.length === 0) return { ok: true, blockers: [] }
  const blockers: string[] = []
  for (const dep of deps) {
    if (!dep) continue
    try {
      // Dependencies normally live beside the task in the same project's tasks subcollection.
      // Do not use collectionGroup + FieldPath.documentId() with bare IDs: Firestore rejects
      // those queries for collection groups because __name__ must be a valid relative path.
      const depSnap = await taskRef.parent.doc(dep).get()
      if (!depSnap.exists) {
        blockers.push(dep)
        continue
      }
      const data = depSnap.data() as TaskData
      if (!isDependencyResolved(data)) blockers.push(dep)
    } catch (err) {
      logger.warn('dependency lookup failed', {
        taskId: taskRef.id,
        dependencyId: dep,
        error: err instanceof Error ? err.message : String(err),
      })
      blockers.push(dep)
    }
  }
  return { ok: blockers.length === 0, blockers }
}

type TaskComment = {
  text?: string
  userName?: string
  userRole?: string
  createdAt?: { toDate?: () => Date; seconds?: number; _seconds?: number } | string | null
}

function commentDate(value: TaskComment['createdAt']): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.toDate === 'function') {
    try { return value.toDate().toISOString() } catch { return '' }
  }
  const seconds = value.seconds ?? value._seconds
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : ''
}

function formatTaskComments(comments: TaskComment[]): string {
  if (comments.length === 0) return ''
  return comments
    .map((comment) => {
      const author = comment.userName || comment.userRole || 'comment'
      const date = commentDate(comment.createdAt)
      return `- ${date ? `${date} ` : ''}${author}: ${comment.text ?? ''}`
    })
    .join('\n')
}

function truncatePromptText(value: string, max = 1_600): string {
  const clean = value.trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max - 1).trimEnd()}…`
}

async function buildProjectDispatchContext(
  taskRef: DocumentReference,
  taskData: TaskData,
): Promise<string> {
  const projectId = taskData.projectId?.trim()
  if (!projectId) return ''

  const lines: string[] = []
  try {
    const projectDoc = await db.collection('projects').doc(projectId).get()
    const project = projectDoc.exists ? projectDoc.data() as Record<string, unknown> | undefined : undefined
    lines.push('Project context:')
    lines.push(`- projectId: ${projectId}`)
    if (typeof project?.name === 'string' && project.name.trim()) lines.push(`- name: ${project.name.trim()}`)
    if (typeof project?.status === 'string' && project.status.trim()) lines.push(`- status: ${project.status.trim()}`)
    const brief = typeof project?.brief === 'string' && project.brief.trim()
      ? project.brief
      : typeof project?.description === 'string' ? project.description : ''
    if (brief.trim()) lines.push(`- brief: ${truncatePromptText(brief, 900)}`)

    const docsSnap = await db
      .collection('projects')
      .doc(projectId)
      .collection('docs')
      .orderBy('createdAt', 'desc')
      .limit(12)
      .get()
    if (!docsSnap.empty) {
      lines.push('- docs:')
      docsSnap.docs.forEach((doc) => {
        const data = doc.data()
        const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : 'Untitled doc'
        const type = typeof data.type === 'string' && data.type.trim() ? data.type.trim() : 'notes'
        lines.push(`  - ${title} (id: ${doc.id}, type: ${type})`)
      })
    }
  } catch (err) {
    logger.warn('failed to load project dispatch context', {
      taskId: taskRef.id,
      projectId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  const deps = taskData.dependsOn?.filter(Boolean) ?? []
  if (deps.length > 0) {
    const depLines: string[] = []
    for (const depId of deps) {
      try {
        const depSnap = await taskRef.parent.doc(depId).get()
        if (!depSnap.exists) continue
        const dep = depSnap.data() as TaskData
        const summary = dep.agentOutput?.summary?.trim()
        if (!summary) continue
        const title = dep.title?.trim() || depId
        depLines.push(`- ${title} (${depId}): ${truncatePromptText(summary)}`)
      } catch (err) {
        logger.warn('failed to load dependency summary for dispatch prompt', {
          taskId: taskRef.id,
          dependencyId: depId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    if (depLines.length > 0) {
      lines.push('Dependency outputs:')
      lines.push(...depLines)
    }
  }

  if (lines.length === 0) return ''
  lines.push(`Before starting, fetch full project context from GET /api/v1/agent/project/${projectId} and use it as the source of truth for docs, task outputs, and comments.`)
  return lines.join('\n')
}

async function loadRecentTaskComments(taskRef: DocumentReference, limit = 8): Promise<TaskComment[]> {
  const maybeCollection = (taskRef as unknown as { collection?: (name: string) => unknown }).collection
  if (typeof maybeCollection !== 'function') return []
  try {
    const collection = maybeCollection.call(taskRef, 'comments') as {
      orderBy: (field: string, direction: 'asc' | 'desc') => { limit: (n: number) => { get: () => Promise<{ docs: Array<{ data: () => TaskComment }> }> } }
    }
    const snap = await collection.orderBy('createdAt', 'desc').limit(limit).get()
    return snap.docs.map((doc) => doc.data()).reverse().filter((comment) => typeof comment.text === 'string' && comment.text.trim().length > 0)
  } catch (err) {
    logger.warn('failed to load task comments for dispatch prompt', {
      taskId: taskRef.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}

export async function dispatchTask(taskRef: DocumentReference, taskData: TaskData): Promise<void> {
  const taskId = taskRef.id
  const agentId = taskData.assigneeAgentId as AgentId | undefined
  const blocker = getTaskDispatchBlocker(taskData, currentAgentIds())
  if (blocker) return
  if (!isActiveAgentId(agentId)) return

  if (inFlight.has(taskRef.path)) return
  if ((perAgentInFlight.get(agentId) ?? 0) >= MAX_CONCURRENT_PER_AGENT) {
    deferTask(agentId, taskRef, taskData)
    return
  }

  // Dependency gating
  const deps = await dependenciesResolved(taskRef, taskData.dependsOn)
  if (!deps.ok) {
    logger.info('task deferred — dependencies not resolved', {
      taskId,
      agentId,
      blockers: deps.blockers,
    })
    return
  }

  inFlight.add(taskRef.path)
  incAgent(agentId)
  let stopHeartbeat: (() => void) | null = null
  let activeRunId: string | null = null

  try {
    // Transactional claim
    const claimed = await claimTask(taskRef, agentId)
    if (!claimed) {
      logger.info('claim lost (another watcher or status changed)', { taskId, agentId })
      return
    }

    // Load agent config
    const cfg = await getAgentConfig(agentId)
    if (!cfg || !cfg.enabled) {
      logger.warn('agent has no enabled dispatch config — marking task blocked', { taskId, agentId })
      await taskRef.update({
        ...agentStatusUpdate('blocked'),
        agentOutput: {
          summary: `Watcher error: agent '${agentId}' has no enabled dispatch config in agent_dispatch_configs.`,
          completedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      })
      return
    }

    // Move to in-progress + start heartbeat
    await taskRef.update({
      ...agentStatusUpdate('in-progress'),
      agentHeartbeatAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    stopHeartbeat = startHeartbeat(taskRef)

    const baseSpec = taskData.agentInput?.spec?.trim() || taskData.title || `Task ${taskId}`
    const commentBlock = formatTaskComments(await loadRecentTaskComments(taskRef))
    const projectContextBlock = await buildProjectDispatchContext(taskRef, taskData)
    const spec = [
      baseSpec,
      projectContextBlock,
      commentBlock ? `Recent task comments / revision notes:\n${commentBlock}` : '',
    ].filter(Boolean).join('\n\n')
    const dispatchInput: TaskDispatchInput = {
      taskId,
      orgId: taskData.orgId ?? '',
      agentId,
      spec,
      context: {
        ...(taskData.agentInput?.context ?? {}),
        ...(taskData.projectId ? { projectId: taskData.projectId } : {}),
        ...(taskData.reviewerAgentId ? { reviewerAgentId: taskData.reviewerAgentId } : {}),
        ...(taskData.riskLevel ? { riskLevel: taskData.riskLevel } : {}),
        ...(taskData.requiredCapability ? { requiredCapability: taskData.requiredCapability } : {}),
        ...(taskData.requestedByAgentId ? { requestedByAgentId: taskData.requestedByAgentId } : {}),
        ...(Array.isArray(taskData.expectedArtifacts) ? { expectedArtifacts: taskData.expectedArtifacts } : {}),
      },
      constraints: taskData.agentInput?.constraints,
      agentEffort: taskData.agentEffort ?? null,
      agentModel: taskData.agentModel ?? null,
    }

    // Callback: fires as soon as the Hermes run is created (before polling completes).
    // Writes agentConversationId so the PiB UI can show a "Live session →" link immediately.
    const onRunCreated = async (runId: string): Promise<void> => {
      activeRunId = runId
      try {
        await taskRef.update({
          agentConversationId: runId,
          updatedAt: FieldValue.serverTimestamp(),
        })
        logger.info('wrote agentConversationId', { taskId, agentId, runId })
      } catch (err) {
        logger.warn('failed to write agentConversationId', {
          taskId,
          agentId,
          runId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    logger.info('dispatching task to Hermes', { taskId, agentId, orgId: dispatchInput.orgId })
    const result = await runAndPoll(cfg, dispatchInput, onRunCreated)
    activeRunId = result.runId ?? activeRunId
    stopHeartbeat?.()
    stopHeartbeat = null

    if (result.error) {
      logger.warn('Hermes run failed — marking blocked', { taskId, agentId, error: result.error })
      await taskRef.update({
        ...agentStatusUpdate('blocked'),
        ...(activeRunId ? { agentConversationId: activeRunId } : {}),
        agentOutput: {
          summary: `Watcher error: ${result.error}`,
          completedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      })
      return
    }

    const summary = (result.output ?? '').slice(0, 4_000) || 'Hermes returned no output.'
    await taskRef.update({
      ...agentStatusUpdate('done'),
      ...(activeRunId ? { agentConversationId: activeRunId } : {}),
      agentOutput: {
        summary,
        completedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
    logger.info('task completed', { taskId, agentId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('dispatchTask threw', { taskId, agentId, error: message })
    try {
      await taskRef.update({
        ...agentStatusUpdate('blocked'),
        ...(activeRunId ? { agentConversationId: activeRunId } : {}),
        agentOutput: {
          summary: `Watcher error: ${message}`,
          completedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      })
    } catch (writeErr) {
      logger.error('failed to write blocked status after dispatch error', {
        taskId,
        error: writeErr instanceof Error ? writeErr.message : String(writeErr),
      })
    }
  } finally {
    stopHeartbeat?.()
    inFlight.delete(taskRef.path)
    decAgent(agentId)
    drainDeferredTasks(agentId)
  }
}


async function addAgentReviewComment(taskRef: DocumentReference, agentId: AgentId, text: string): Promise<void> {
  await taskRef.collection('comments').add({
    text,
    userId: `agent:${agentId}`,
    userName: agentId.charAt(0).toUpperCase() + agentId.slice(1),
    userRole: 'ai',
    createdAt: FieldValue.serverTimestamp(),
    agentPickedUp: false,
    agentPickedUpAt: null,
  })
}

function reviewFailed(output: string): boolean {
  return /^\s*(CHANGES[_ -]?REQUESTED|REJECTED|NOT[_ -]?APPROVED)\b/i.test(output)
}

function reviewApproved(output: string): boolean {
  return /^\s*APPROVED\b/i.test(output) && !reviewFailed(output)
}

async function dispatchReview(taskRef: DocumentReference, taskData: TaskData): Promise<void> {
  const taskId = taskRef.id
  const agentId = taskData.reviewerAgentId as AgentId | undefined
  if (!isActiveAgentId(agentId)) return
  if (taskData.columnId !== 'review' || taskData.reviewStatus !== 'pending') return
  if (inFlight.has(`${taskRef.path}:review`)) return
  if ((perAgentInFlight.get(agentId) ?? 0) >= MAX_CONCURRENT_PER_AGENT) return

  inFlight.add(`${taskRef.path}:review`)
  incAgent(agentId)
  try {
    const claimed = await claimReviewTask(taskRef, agentId)
    if (!claimed) {
      logger.info('review claim lost (another watcher or status changed)', { taskId, agentId })
      return
    }

    const cfg = await getAgentConfig(agentId)
    if (!cfg || !cfg.enabled) {
      await addAgentReviewComment(taskRef, agentId, `Review could not run: reviewer agent '${agentId}' has no enabled dispatch config.`)
      await taskRef.update({ reviewStatus: 'changes-requested', updatedAt: FieldValue.serverTimestamp() })
      return
    }
    const spec = [
      `Review this completed task. Return APPROVED if it passes, or CHANGES_REQUESTED followed by clear feedback if it fails.`,
      `Task: ${taskData.title ?? taskId}`,
      taskData.agentOutput?.summary ? `Implementation summary:\n${taskData.agentOutput.summary}` : '',
    ].filter(Boolean).join('\n\n')
    const result = await runAndPoll(cfg, {
      taskId,
      orgId: taskData.orgId ?? '',
      agentId,
      spec,
      context: { reviewTask: true, projectId: taskData.projectId ?? null },
      constraints: ['Be strict. If changes are needed, start with CHANGES_REQUESTED and explain exactly what to fix.'],
      agentEffort: 'medium',
    })
    const output = (result.error ? `Reviewer error: ${result.error}` : result.output ?? '').slice(0, 4_000)
    if (result.error || reviewFailed(output) || !reviewApproved(output)) {
      await addAgentReviewComment(taskRef, agentId, output || 'CHANGES_REQUESTED: Review failed without details.')
      await taskRef.update({
        columnId: 'todo',
        agentStatus: 'pending',
        reviewStatus: 'changes-requested',
        agentHeartbeatAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return
    }
    await addAgentReviewComment(taskRef, agentId, output || 'APPROVED')
    await taskRef.update({
      columnId: 'done',
      reviewStatus: 'approved',
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('dispatchReview threw', { taskId, agentId, error: message })
    try {
      await addAgentReviewComment(taskRef, agentId, `Reviewer error: ${message}`)
      await taskRef.update({ reviewStatus: 'pending', updatedAt: FieldValue.serverTimestamp() })
    } catch {}
  } finally {
    inFlight.delete(`${taskRef.path}:review`)
    decAgent(agentId)
  }
}

async function releaseDueScheduledTasks(now = Date.now()): Promise<void> {
  if (scheduledReleaseSweepDisabled) return
  try {
    const snap = await db
      .collectionGroup('tasks')
      .where('agentReleaseStatus', '==', 'scheduled')
      .where('agentStatus', '==', 'pending')
      .limit(MAX_SCHEDULED_RELEASE_SWEEP_DOCS)
      .get()

    await Promise.all(snap.docs.map(async (doc) => {
      const data = (doc.data() ?? {}) as TaskData
      const dueAt = releaseMillis(data.agentReleaseAt)
      if (dueAt === null || dueAt > now) return
      await doc.ref.update({
        columnId: 'todo',
        agentReleaseStatus: 'released',
        agentReleasedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      await doc.ref.collection('comments').add({
        text: `Scheduled backlog release reached. Moved to To Do for agent pickup.`,
        userId: 'system:agent-watcher',
        userName: 'Agent watcher',
        userRole: 'system',
        createdAt: FieldValue.serverTimestamp(),
        agentPickedUp: false,
        agentPickedUpAt: null,
      })
    }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('FAILED_PRECONDITION')) {
      scheduledReleaseSweepDisabled = true
      logger.error('scheduled backlog release sweep disabled until the tasks collection-group index exists', { error: message })
      return
    }
    logger.error('scheduled backlog release sweep failed', {
      error: message,
    })
  }
}

async function releaseDependencyClearedDocs(
  docs: Array<{ ref: DocumentReference; data: () => Record<string, unknown> | undefined }>,
  waitingStatus: string,
  now: number,
  allowedAgentIds?: readonly string[],
): Promise<void> {
  await Promise.all(docs.map(async (doc) => {
    const data = (doc.data() ?? {}) as TaskData
    if (!isActiveAgentId(data.assigneeAgentId)) return
    if (allowedAgentIds && !allowedAgentIds.includes(data.assigneeAgentId)) return
    if (data.columnId !== 'blocked') return
    if (!Array.isArray(data.dependsOn) || data.dependsOn.filter(Boolean).length === 0) return
    if (waitingStatus === 'blocked' && typeof data.agentOutput?.summary === 'string' && data.agentOutput.summary.trim()) return
    if (data.deleted === true || data.status === 'cancelled' || data.status === 'canceled') return
    if (hasPendingApprovalGate(data) || hasPendingScheduledRelease(data, now)) return

    const deps = await dependenciesResolved(doc.ref, data.dependsOn)
    if (!deps.ok) return

    const releasedData: TaskData = {
      ...data,
      agentStatus: 'pending',
      columnId: 'todo',
    }
    await doc.ref.update({
      ...agentStatusUpdate('pending'),
      agentHeartbeatAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    await doc.ref.collection('comments').add({
      text: `Dependency gate cleared. All dependsOn tasks are complete; moved back to To Do for agent pickup.`,
      userId: 'system:agent-watcher',
      userName: 'Agent watcher',
      userRole: 'system',
      createdAt: FieldValue.serverTimestamp(),
      agentPickedUp: false,
      agentPickedUpAt: null,
    })
    void dispatchTask(doc.ref, releasedData)
  }))
}

async function releaseDependencyClearedTasks(now = Date.now()): Promise<void> {
  const chunks = chunkAgentIds(currentAgentIds())
  for (const chunk of chunks) {
    for (const waitingStatus of ['awaiting-input', 'blocked']) {
      try {
        const snap = await db
          .collectionGroup('tasks')
          .where('assigneeAgentId', 'in', chunk)
          .where('agentStatus', '==', waitingStatus)
          .where('columnId', '==', 'blocked')
          .limit(MAX_DEPENDENCY_RELEASE_SWEEP_DOCS)
          .get()

        await releaseDependencyClearedDocs(snap.docs, waitingStatus, now)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (message.includes('FAILED_PRECONDITION')) {
          logger.warn('dependency-cleared indexed sweep unavailable; falling back to agentStatus-only scan', {
            agents: chunk,
            agentStatus: waitingStatus,
            error: message,
          })
          try {
            const fallbackSnap = await db
              .collectionGroup('tasks')
              .where('agentStatus', '==', waitingStatus)
              .limit(MAX_DEPENDENCY_RELEASE_SWEEP_DOCS)
              .get()
            await releaseDependencyClearedDocs(fallbackSnap.docs, waitingStatus, now, chunk)
          } catch (fallbackErr) {
            logger.error('dependency-cleared task fallback release sweep failed', {
              agents: chunk,
              agentStatus: waitingStatus,
              error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
            })
          }
          continue
        }
        logger.error('dependency-cleared task release sweep failed', {
          agents: chunk,
          agentStatus: waitingStatus,
          error: message,
        })
      }
    }
  }
}

export async function sweepReadyPendingTasks(now = Date.now()): Promise<void> {
  await releaseDueScheduledTasks(now)
  await releaseDependencyClearedTasks(now)
  const chunks = chunkAgentIds(currentAgentIds())
  for (const chunk of chunks) {
    try {
      const snap = await db
        .collectionGroup('tasks')
        .where('assigneeAgentId', 'in', chunk)
        .where('agentStatus', '==', 'pending')
        .where('columnId', '==', 'todo')
        .limit(MAX_READY_SWEEP_DOCS)
        .get()

      snap.docs.forEach((doc) => {
        const data = (doc.data() ?? {}) as TaskData
        void dispatchTask(doc.ref, data)
      })
    } catch (err) {
      logger.error('ready pending task sweep failed', {
        agents: chunk,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

export function inFlightCount(): number {
  return inFlight.size
}

export async function startWatcher(agentIds?: readonly string[]): Promise<() => void> {
  const enabledAgentIds = agentIds && agentIds.length > 0 ? Array.from(new Set(agentIds)) : await loadEnabledAgentIds()
  activeAgentIds = new Set(enabledAgentIds)
  const agentChunks = chunkAgentIds(currentAgentIds())

  logger.info('starting Firestore watcher', { agents: currentAgentIds() })

  const unsubscribes = agentChunks.map((chunk) => db
    .collectionGroup('tasks')
    .where('assigneeAgentId', 'in', chunk)
    .where('agentStatus', '==', 'pending')
    .where('columnId', '==', 'todo')
    .onSnapshot(
      (snap: QuerySnapshot) => {
        snap.docChanges().forEach((change) => {
          if (change.type !== 'added' && change.type !== 'modified') return
          const doc: DocumentSnapshot = change.doc
          const data = (doc.data() ?? {}) as TaskData
          // Fire-and-forget; dispatchTask owns its own error handling.
          void dispatchTask(doc.ref, data)
        })
      },
      (err: Error) => {
        logger.error('Firestore snapshot listener error', { error: err.message })
        // onSnapshot auto-reconnects internally; just log the surface error.
      },
    ))

  const reviewUnsubscribes = agentChunks.map((chunk) => db
    .collectionGroup('tasks')
    .where('reviewerAgentId', 'in', chunk)
    .where('columnId', '==', 'review')
    .where('reviewStatus', '==', 'pending')
    .onSnapshot(
      (snap: QuerySnapshot) => {
        snap.docChanges().forEach((change) => {
          if (change.type !== 'added' && change.type !== 'modified') return
          const doc: DocumentSnapshot = change.doc
          const data = (doc.data() ?? {}) as TaskData
          void dispatchReview(doc.ref, data)
        })
      },
      (err: Error) => logger.error('Firestore review snapshot listener error', { error: err.message }),
    ))

  // Dependency transitions are retried by sweepReadyPendingTasks(). Keeping this
  // as a bounded sweep avoids two broad "all done tasks" listeners per watcher.
  const readyTaskSweep = setInterval(() => {
    void sweepReadyPendingTasks()
  }, READY_TASK_SWEEP_MS)
  readyTaskSweep.unref?.()

  return () => {
    try {
      clearInterval(readyTaskSweep)
      unsubscribes.forEach((unsubscribe) => unsubscribe())
      reviewUnsubscribes.forEach((unsubscribe) => unsubscribe())
    } catch (err) {
      logger.warn('unsubscribe threw', { error: err instanceof Error ? err.message : String(err) })
    }
  }
}
