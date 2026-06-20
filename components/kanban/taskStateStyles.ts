import type { Task } from './types'

export type TaskStateTone = 'blocked' | 'review' | 'in-progress' | 'done' | 'todo'

export type TaskStateStyle = {
  tone: TaskStateTone
  label: string
  railColor: string
  tint: string
  softTint: string
  pillClassName: string
}

const TASK_STATE_STYLES: Record<TaskStateTone, TaskStateStyle> = {
  blocked: {
    tone: 'blocked',
    label: 'Blocked',
    railColor: '#ef4444',
    tint: 'linear-gradient(90deg, rgba(239,68,68,0.18), rgba(239,68,68,0.06) 42%, var(--color-card) 100%)',
    softTint: 'rgba(239,68,68,0.08)',
    pillClassName: 'border-red-400/35 bg-red-500/15 text-red-200',
  },
  review: {
    tone: 'review',
    label: 'Review',
    railColor: '#a855f7',
    tint: 'linear-gradient(90deg, rgba(168,85,247,0.17), rgba(168,85,247,0.06) 42%, var(--color-card) 100%)',
    softTint: 'rgba(168,85,247,0.08)',
    pillClassName: 'border-purple-400/35 bg-purple-500/15 text-purple-200',
  },
  'in-progress': {
    tone: 'in-progress',
    label: 'In progress',
    railColor: '#38bdf8',
    tint: 'linear-gradient(90deg, rgba(56,189,248,0.16), rgba(56,189,248,0.055) 42%, var(--color-card) 100%)',
    softTint: 'rgba(56,189,248,0.075)',
    pillClassName: 'border-sky-400/35 bg-sky-500/15 text-sky-200',
  },
  done: {
    tone: 'done',
    label: 'Done',
    railColor: '#22c55e',
    tint: 'linear-gradient(90deg, rgba(34,197,94,0.16), rgba(34,197,94,0.055) 42%, var(--color-card) 100%)',
    softTint: 'rgba(34,197,94,0.075)',
    pillClassName: 'border-emerald-400/35 bg-emerald-500/15 text-emerald-200',
  },
  todo: {
    tone: 'todo',
    label: 'To do',
    railColor: '#94a3b8',
    tint: 'linear-gradient(90deg, rgba(148,163,184,0.13), rgba(148,163,184,0.045) 42%, var(--color-card) 100%)',
    softTint: 'rgba(148,163,184,0.065)',
    pillClassName: 'border-slate-400/30 bg-white/10 text-on-surface-variant',
  },
}

function normalized(value?: string | null): string {
  return value?.toLowerCase().trim().replace(/_/g, '-') ?? ''
}

type TaskStateLike = Pick<Task, 'columnId' | 'agentStatus' | 'reviewStatus' | 'approvalStatus'> & {
  status?: string | null
}

export function getTaskStateTone(task: TaskStateLike): TaskStateTone {
  const columnId = normalized(task.columnId)
  const agentStatus = normalized(task.agentStatus)
  const status = normalized(task.status)
  const reviewStatus = normalized(task.reviewStatus)
  const approvalStatus = normalized(task.approvalStatus)

  if (columnId === 'blocked' || agentStatus === 'blocked' || agentStatus === 'awaiting-input' || status === 'blocked') {
    return 'blocked'
  }

  if (
    columnId === 'review' ||
    status === 'review' ||
    status === 'pending-review' ||
    reviewStatus === 'pending' ||
    reviewStatus === 'in-progress' ||
    reviewStatus === 'changes-requested' ||
    (reviewStatus === 'approved' && approvalStatus === 'pending')
  ) {
    return 'review'
  }

  if (columnId === 'in-progress' || status === 'in-progress' || agentStatus === 'picked-up' || agentStatus === 'in-progress') {
    return 'in-progress'
  }

  if (columnId === 'done' || status === 'done' || status === 'completed' || agentStatus === 'done' || approvalStatus === 'approved' || reviewStatus === 'approved') {
    return 'done'
  }

  return 'todo'
}

export function getTaskStateStyle(task: TaskStateLike): TaskStateStyle {
  return TASK_STATE_STYLES[getTaskStateTone(task)]
}
