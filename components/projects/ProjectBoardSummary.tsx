'use client'

import type { Task } from '@/components/kanban/types'

type BoardColumnLike = {
  id: string
  name: string
  color?: string
}

type SummaryStat = {
  key: string
  label: string
  value: number
  icon: string
  tone: string
  helper: string
}

const DEFAULT_TRACKED_COLUMNS: BoardColumnLike[] = [
  { id: 'backlog', name: 'Backlog', color: 'var(--color-outline)' },
  { id: 'todo', name: 'To Do', color: '#60a5fa' },
  { id: 'in_progress', name: 'In Progress', color: 'var(--color-accent-v2)' },
  { id: 'blocked', name: 'Blocked', color: '#ef4444' },
  { id: 'review', name: 'Review', color: '#c084fc' },
  { id: 'done', name: 'Done', color: '#4ade80' },
]

function isActiveBlocker(task: Task): boolean {
  return task.columnId === 'blocked' || task.agentStatus === 'blocked' || task.agentStatus === 'awaiting-input'
}

function isDueThisWeek(task: Task): boolean {
  const due = timestampToMillis(task.dueDate)
  if (!due) return false
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const nextWeek = new Date(now)
  nextWeek.setDate(now.getDate() + 7)
  return due >= now.getTime() && due <= nextWeek.getTime()
}

function timestampToMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const timestamp = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

export function getProjectBoardSummary(tasks: Task[], columns: BoardColumnLike[] = DEFAULT_TRACKED_COLUMNS) {
  const trackedColumns = columns.length > 0 ? columns : DEFAULT_TRACKED_COLUMNS
  const columnCounts = new Map(trackedColumns.map(column => [column.id, 0]))

  for (const task of tasks) {
    const columnId = typeof task.columnId === 'string' && task.columnId.length > 0 ? task.columnId : 'backlog'
    columnCounts.set(columnId, (columnCounts.get(columnId) ?? 0) + 1)
  }

  const total = tasks.length
  const done = columnCounts.get('done') ?? 0
  const review = columnCounts.get('review') ?? 0
  const blocked = tasks.filter(isActiveBlocker).length
  const inProgress = columnCounts.get('in_progress') ?? 0
  const dueSoon = tasks.filter(isDueThisWeek).length
  const open = Math.max(total - done, 0)
  const progress = total === 0 ? 0 : Math.round((done / total) * 100)

  const stats: SummaryStat[] = [
    { key: 'open', label: 'Open', value: open, icon: 'radio_button_unchecked', tone: '#60a5fa', helper: 'Not in Done' },
    { key: 'in_progress', label: 'In progress', value: inProgress, icon: 'autorenew', tone: 'var(--color-accent-v2)', helper: 'In Progress column' },
    { key: 'blocked', label: 'Blocked', value: blocked, icon: 'block', tone: '#ef4444', helper: 'Blocked column or agent waiting' },
    { key: 'review', label: 'Review', value: review, icon: 'rate_review', tone: '#c084fc', helper: 'Waiting for approval' },
    { key: 'done', label: 'Done', value: done, icon: 'check_circle', tone: '#4ade80', helper: 'Done column only' },
  ]

  return { total, done, review, blocked, inProgress, dueSoon, open, progress, columnCounts, stats, columns: trackedColumns }
}

export function ProjectBoardSummary({ tasks, columns }: { tasks: Task[]; columns: BoardColumnLike[] }) {
  const summary = getProjectBoardSummary(tasks, columns)
  const activeColumns = summary.columns.filter(column => (summary.columnCounts.get(column.id) ?? 0) > 0)

  return (
    <section
      aria-label="Project board summary"
      className="mb-3 shrink-0 overflow-hidden rounded-2xl border border-[var(--color-card-border)] bg-[linear-gradient(135deg,var(--color-card),var(--color-surface-container))] shadow-[0_18px_45px_rgba(0,0,0,0.20)] md:mb-4"
    >
      <div className="grid gap-0 md:grid-cols-[minmax(220px,0.85fr)_minmax(0,1.6fr)]">
        <div className="border-b border-[var(--color-card-border)] p-4 md:border-b-0 md:border-r md:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-label uppercase tracking-[0.18em] text-on-surface-variant">Board progress</p>
              <p aria-label="Done task progress" className="mt-2 text-3xl font-headline font-bold text-on-surface md:text-4xl">
                {summary.done} / {summary.total}
              </p>
              <p className="mt-1 text-xs text-on-surface-variant">tasks in Done</p>
            </div>
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#4ade8040] bg-[#4ade8016] text-[#4ade80]">
              <span className="material-symbols-outlined text-[24px]">task_alt</span>
            </span>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-[11px] text-on-surface-variant">
              <span>Completion</span>
              <span className="font-mono">{summary.progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-black/20">
              <div className="h-full rounded-full bg-[#4ade80] transition-all" style={{ width: `${summary.progress}%` }} />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-on-surface-variant">
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-card-border)] px-2 py-1">
              <span className="material-symbols-outlined text-[14px]">event</span>
              {summary.dueSoon} due this week
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-card-border)] px-2 py-1">
              <span className="material-symbols-outlined text-[14px]">pending_actions</span>
              {summary.open} still open
            </span>
          </div>
        </div>

        <div className="p-3 md:p-4">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            {summary.stats.map(stat => (
              <div
                key={stat.key}
                className="rounded-xl border border-[var(--color-card-border)] bg-black/[0.10] p-3"
                style={{ boxShadow: `inset 0 1px 0 ${stat.tone}22` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{stat.label}</span>
                  <span className="material-symbols-outlined text-[17px]" style={{ color: stat.tone }}>{stat.icon}</span>
                </div>
                <p aria-label={`${stat.label} task count`} className="mt-2 text-2xl font-headline font-bold text-on-surface">{stat.value}</p>
                <p className="mt-1 min-h-[2rem] text-[11px] leading-4 text-on-surface-variant">{stat.helper}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-black/20" aria-label="Board column distribution">
            {activeColumns.length === 0 ? (
              <div className="h-full w-full bg-[var(--color-outline)]/30" />
            ) : activeColumns.map(column => {
              const count = summary.columnCounts.get(column.id) ?? 0
              return (
                <div
                  key={column.id}
                  title={`${column.name}: ${count}`}
                  className="h-full min-w-[3px]"
                  style={{ width: `${(count / summary.total) * 100}%`, background: column.color ?? 'var(--color-outline)' }}
                />
              )
            })}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {summary.columns.map(column => {
              const count = summary.columnCounts.get(column.id) ?? 0
              return (
                <span key={column.id} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-card-border)] px-2.5 py-1 text-[11px] text-on-surface-variant">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: column.color ?? 'var(--color-outline)' }} />
                  {column.name} {count}
                </span>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
