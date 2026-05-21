/**
 * Firestore onSnapshot listener + dispatch coordinator.
 *
 * Subscribes to all tasks (collectionGroup) where assigneeAgentId ∈ AGENT_IDS and
 * agentStatus = 'pending'. For each added/modified doc, attempts to claim it and run
 * it on Hermes. In-flight task IDs are tracked so rapid snapshot updates don't double-process.
 *
 * Concurrency cap: 5 active dispatches per agent.
 */
import type { DocumentReference, DocumentSnapshot, QuerySnapshot } from 'firebase-admin/firestore'
import { db, FieldValue } from './firestore'
import { AGENT_IDS, getAgentConfig, type AgentId } from './config'
import { claimReviewTask, claimTask, startHeartbeat } from './claim'
import { runAndPoll, type TaskDispatchInput } from './hermes'
import { logger } from './logger'
import { agentStatusUpdate } from './task-updates'
import { getTaskDispatchBlocker, isDependencyResolved } from './eligibility'

const MAX_CONCURRENT_PER_AGENT = 5

const inFlight = new Set<string>()
const perAgentInFlight = new Map<AgentId, number>()

function incAgent(agentId: AgentId): void {
  perAgentInFlight.set(agentId, (perAgentInFlight.get(agentId) ?? 0) + 1)
}
function decAgent(agentId: AgentId): void {
  const cur = perAgentInFlight.get(agentId) ?? 0
  perAgentInFlight.set(agentId, Math.max(0, cur - 1))
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

export async function dispatchTask(taskRef: DocumentReference, taskData: TaskData): Promise<void> {
  const taskId = taskRef.id
  const agentId = taskData.assigneeAgentId as AgentId | undefined
  const blocker = getTaskDispatchBlocker(taskData, AGENT_IDS as readonly string[])
  if (blocker) return
  if (!agentId || !AGENT_IDS.includes(agentId)) return

  if (inFlight.has(taskRef.path)) return
  if ((perAgentInFlight.get(agentId) ?? 0) >= MAX_CONCURRENT_PER_AGENT) {
    // Snapshot will retrigger later when capacity frees up.
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

    const spec = taskData.agentInput?.spec?.trim() || taskData.title || `Task ${taskId}`
    const dispatchInput: TaskDispatchInput = {
      taskId,
      orgId: taskData.orgId ?? '',
      agentId,
      spec,
      context: taskData.agentInput?.context,
      constraints: taskData.agentInput?.constraints,
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
  return /\b(changes[_ -]?requested|fail(?:ed)?|reject(?:ed)?|not approved)\b/i.test(output)
}

function reviewApproved(output: string): boolean {
  return /^\s*APPROVED\b/i.test(output) && !reviewFailed(output)
}

async function dispatchReview(taskRef: DocumentReference, taskData: TaskData): Promise<void> {
  const taskId = taskRef.id
  const agentId = taskData.reviewerAgentId as AgentId | undefined
  if (!agentId || !AGENT_IDS.includes(agentId)) return
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

async function dispatchDependents(completedTaskId: string): Promise<void> {
  try {
    const snap = await db
      .collectionGroup('tasks')
      .where('dependsOn', 'array-contains', completedTaskId)
      .where('agentStatus', '==', 'pending')
      .where('columnId', '==', 'todo')
      .get()

    snap.docs.forEach((doc) => {
      const data = (doc.data() ?? {}) as TaskData
      void dispatchTask(doc.ref, data)
    })
  } catch (err) {
    logger.error('dependent task dispatch query failed', {
      completedTaskId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export function inFlightCount(): number {
  return inFlight.size
}

export function startWatcher(): () => void {
  logger.info('starting Firestore watcher', { agents: AGENT_IDS as readonly string[] })

  const unsubscribe = db
    .collectionGroup('tasks')
    .where('assigneeAgentId', 'in', AGENT_IDS as unknown as string[])
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
    )

  const reviewUnsubscribe = db
    .collectionGroup('tasks')
    .where('reviewerAgentId', 'in', AGENT_IDS as unknown as string[])
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
    )

  const dependencyUnsubscribe = db
    .collectionGroup('tasks')
    .where('columnId', '==', 'done')
    .onSnapshot(
      (snap: QuerySnapshot) => {
        snap.docChanges().forEach((change) => {
          if (change.type !== 'added' && change.type !== 'modified') return
          void dispatchDependents(change.doc.id)
        })
      },
      (err: Error) => logger.error('Firestore dependency snapshot listener error', { error: err.message }),
    )

  return () => {
    try {
      unsubscribe()
      reviewUnsubscribe()
      dependencyUnsubscribe()
    } catch (err) {
      logger.warn('unsubscribe threw', { error: err instanceof Error ? err.message : String(err) })
    }
  }
}
