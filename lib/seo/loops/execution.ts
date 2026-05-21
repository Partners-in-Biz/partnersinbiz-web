import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { lastActorFrom } from '@/lib/api/actor'
import {
  ensureSeoBlockerHandoff,
  ensureSeoQueuedAgentHandoff,
  resolveSeoBlockerHandoff,
} from '@/lib/seo/blocker-handoff'

export interface ExecutorResult {
  status: 'done' | 'queued' | 'blocked'
  artifactId?: string
  blockerReason?: string
  notes?: string
}

export type Executor = (taskId: string, sprintId: string, user: ApiUser) => Promise<ExecutorResult>

const executors: Record<string, Executor> = {}

export function registerExecutor(taskType: string, fn: Executor) {
  executors[taskType] = fn
}

export function getExecutor(taskType: string): Executor | undefined {
  return executors[taskType]
}

const DEFAULT_SAFE_TASK_TYPES = new Set([
  'meta-tag-audit',
  'robots-check',
  'pagespeed-check',
  'cwv-check',
  'canonical-check',
  'gsc-index-check',
  'sitemap-submit',
  'keyword-record',
  'directory-submission',
  'audit-snapshot',
  'audit-render',
  'internal-link-add',
  'gsc-stuck-pages',
  'schema-add',
  'keyword-bucket',
  'keyword-prioritize',
  'keyword-discover',
])

// Lazy-load executors to avoid circular import (executors.ts imports registerExecutor from this file)
let executorsLoaded = false
async function ensureExecutorsLoaded() {
  if (executorsLoaded) return
  executorsLoaded = true
  await import('./executors')
}

export async function executeTask(taskId: string, user: ApiUser): Promise<ExecutorResult> {
  await ensureExecutorsLoaded()
  const taskSnap = await adminDb.collection('seo_tasks').doc(taskId).get()
  if (!taskSnap.exists) return { status: 'blocked', blockerReason: 'Task not found' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const task = taskSnap.data() as any
  const sprintSnap = await adminDb.collection('seo_sprints').doc(task.sprintId).get()
  if (!sprintSnap.exists) return { status: 'blocked', blockerReason: 'Sprint not found' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sprint = sprintSnap.data() as any

  if (!task.autopilotEligible) return { status: 'queued', blockerReason: 'requires human' }
  if (sprint.autopilotMode === 'off') return { status: 'blocked', blockerReason: 'autopilot off' }

  if (sprint.autopilotMode === 'safe') {
    const allowed = new Set<string>(sprint.autopilotTaskTypes ?? [])
    if (!allowed.has(task.taskType) && !DEFAULT_SAFE_TASK_TYPES.has(task.taskType)) {
      return { status: 'queued', blockerReason: 'taskType not in safe-mode allowlist' }
    }
  }

  const executor = executors[task.taskType]
  if (!executor) return { status: 'queued', blockerReason: `no executor for ${task.taskType}` }
  try {
    return await executor(taskId, task.sprintId, user)
  } catch (e) {
    return { status: 'blocked', blockerReason: `executor error: ${(e as Error).message}` }
  }
}

export async function runExecutionLoopForSprint(
  sprintId: string,
  user: ApiUser,
): Promise<{
  done: string[]
  queued: string[]
  blocked: { taskId: string; reason: string }[]
  agentHandoff?: {
    projectId: string | null
    projectTaskId: string | null
    taskIds: string[]
  } | null
}> {
  await ensureExecutorsLoaded()
  const sprintSnap = await adminDb.collection('seo_sprints').doc(sprintId).get()
  if (!sprintSnap.exists) return { done: [], queued: [], blocked: [{ taskId: 'sprint', reason: 'Sprint not found' }] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = sprintSnap.data() as any
  const plan = data.todayPlan
  const ids = [...(plan?.due ?? []), ...(plan?.inProgress ?? [])]
  const out: {
    done: string[]
    queued: string[]
    blocked: { taskId: string; reason: string }[]
    agentHandoff?: {
      projectId: string | null
      projectTaskId: string | null
      taskIds: string[]
    } | null
  } = {
    done: [] as string[],
    queued: [] as string[],
    blocked: [] as { taskId: string; reason: string }[],
  }
  for (const id of ids) {
    const r = await executeTask(id, user)
    if (r.status === 'done') {
      out.done.push(id)
      await adminDb.collection('seo_tasks').doc(id).update({
        status: 'done',
        completedAt: FieldValue.serverTimestamp(),
        completedBy: user.uid,
        outputArtifactId: r.artifactId ?? null,
        ...lastActorFrom(user),
      })
      await resolveSeoBlockerHandoff(id, user)
    } else if (r.status === 'queued') {
      out.queued.push(id)
      await adminDb.collection('seo_tasks').doc(id).update({
        status: 'in_progress',
        blockerReason: r.blockerReason ?? null,
        ...lastActorFrom(user),
      })
    } else {
      out.blocked.push({ taskId: id, reason: r.blockerReason ?? 'unknown' })
      await adminDb.collection('seo_tasks').doc(id).update({
        status: 'blocked',
        blockerReason: r.blockerReason ?? null,
        ...lastActorFrom(user),
      })
      await ensureSeoBlockerHandoff({
        taskId: id,
        reason: r.blockerReason,
        actor: user,
      })
    }
  }
  if (out.queued.length > 0) {
    const agentHandoff = await ensureSeoQueuedAgentHandoff({
      sprintId,
      taskIds: out.queued,
      actor: user,
    })
    if (agentHandoff) out.agentHandoff = agentHandoff
  }
  return out
}
