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
import { FieldPath } from 'firebase-admin/firestore'
import { db, FieldValue } from './firestore'
import { AGENT_IDS, getAgentConfig, type AgentId } from './config'
import { claimTask, startHeartbeat } from './claim'
import { runAndPoll, type TaskDispatchInput } from './hermes'
import { logger } from './logger'
import { agentStatusUpdate } from './task-updates'

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
}

async function dependenciesResolved(deps: string[] | undefined): Promise<{ ok: boolean; blockers: string[] }> {
  if (!deps || deps.length === 0) return { ok: true, blockers: [] }
  const blockers: string[] = []
  for (const dep of deps) {
    if (!dep) continue
    try {
      // Tasks live in a subcollection — we don't know the projectId here, so collectionGroup
      // by document ID is the most reliable lookup.
      const snap = await db.collectionGroup('tasks').where(FieldPath.documentId(), '==', dep).limit(1).get()
      if (snap.empty) {
        blockers.push(dep)
        continue
      }
      const data = snap.docs[0].data() as TaskData
      if (data.agentStatus !== 'done') blockers.push(dep)
    } catch {
      blockers.push(dep)
    }
  }
  return { ok: blockers.length === 0, blockers }
}

async function dispatchTask(taskRef: DocumentReference, taskData: TaskData): Promise<void> {
  const taskId = taskRef.id
  const agentId = taskData.assigneeAgentId as AgentId | undefined
  if (!agentId || !AGENT_IDS.includes(agentId)) return

  if (inFlight.has(taskRef.path)) return
  if ((perAgentInFlight.get(agentId) ?? 0) >= MAX_CONCURRENT_PER_AGENT) {
    // Snapshot will retrigger later when capacity frees up.
    return
  }

  // Dependency gating
  const deps = await dependenciesResolved(taskData.dependsOn)
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

  try {
    // Transactional claim
    const claimed = await claimTask(taskRef)
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
    const stopHeartbeat = startHeartbeat(taskRef)

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
    const onRunCreated = (runId: string): void => {
      void taskRef.update({
        agentConversationId: runId,
        updatedAt: FieldValue.serverTimestamp(),
      }).then(() => {
        logger.info('wrote agentConversationId', { taskId, agentId, runId })
      }).catch((err: unknown) => {
        logger.warn('failed to write agentConversationId', {
          taskId,
          agentId,
          runId,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }

    logger.info('dispatching task to Hermes', { taskId, agentId, orgId: dispatchInput.orgId })
    const result = await runAndPoll(cfg, dispatchInput, onRunCreated)
    stopHeartbeat()

    if (result.error) {
      logger.warn('Hermes run failed — marking blocked', { taskId, agentId, error: result.error })
      await taskRef.update({
        ...agentStatusUpdate('blocked'),
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
    inFlight.delete(taskRef.path)
    decAgent(agentId)
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

  return () => {
    try {
      unsubscribe()
    } catch (err) {
      logger.warn('unsubscribe threw', { error: err instanceof Error ? err.message : String(err) })
    }
  }
}
