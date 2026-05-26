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
  ariaLabel: string
}

type TaskWithStatusSignals = Task & {
  status?: string | null
}

const DEFAULT_TRACKED_COLUMNS: BoardColumnLike[] = [
  { id: 'backlog', name: 'Backlog', color: 'var(--color-outline)' },
  { id: 'todo', name: 'To Do', color: '#60a5fa' },
  { id: 'in_progress', name: 'In Progress', color: 'var(--color-accent-v2)' },
  { id: 'blocked', name: 'Blocked', color: '#ef4444' },
  { id: 'review', name: 'Review', color: '#c084fc' },
  { id: 'done', name: 'Done', color: '#4ade80' },
]

function isTaskDone(task: Task): boolean {
  const withStatus = task as TaskWithStatusSignals
  const status = typeof withStatus.status === 'string' ? withStatus.status.toLowerCase() : null
  return (
    task.columnId === 'done' ||
    task.agentStatus === 'done' ||
    status === 'done' ||
    status === 'completed' ||
    Boolean(task.completedAt)
  )
}

function isActiveBlocker(task: Task): boolean {
  if (isTaskDone(task)) return false
  return task.columnId === 'blocked' || task.agentStatus === 'blocked' || task.agentStatus === 'awaiting-input'
}

function isDueThisWeek(task: Task): boolean {
  const due = timestampToMillis(task.dueDate)
  if (!due) return false
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay())
  const nextWeek = new Date(now)
  nextWeek.setDate(now.getDate() + 7)
  return due >= weekStart.getTime() && due <= nextWeek.getTime()
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
  const boardDone = columnCounts.get('done') ?? 0
  const agentDone = tasks.filter(task => task.agentStatus === 'done').length
  const done = tasks.filter(isTaskDone).length
  const review = tasks.filter(task => task.columnId === 'review' && !isTaskDone(task)).length
  const blocked = tasks.filter(isActiveBlocker).length
  const inProgress = columnCounts.get('in_progress') ?? 0
  const dueSoon = tasks.filter(isDueThisWeek).length
  const open = Math.max(total - done, 0)
  const progress = total === 0 ? 0 : Math.round((done / total) * 100)

  const stats: SummaryStat[] = [
    { key: 'done', label: 'Actually done', value: done, icon: 'task_alt', tone: '#4ade80', helper: `${boardDone} in Done · ${agentDone} agent-done`, ariaLabel: 'Done task count' },
    { key: 'open', label: 'Still open', value: open, icon: 'radio_button_unchecked', tone: '#60a5fa', helper: 'Excludes Done, completed, and agent-done', ariaLabel: 'Open task count' },
    { key: 'in_progress', label: 'In progress', value: inProgress, icon: 'autorenew', tone: 'var(--color-accent-v2)', helper: 'Cards sitting in In Progress', ariaLabel: 'In progress task count' },
    { key: 'blocked', label: 'Blocked now', value: blocked, icon: 'block', tone: '#ef4444', helper: 'Active blocked/waiting only', ariaLabel: 'Blocked task count' },
    { key: 'review', label: 'Needs review', value: review, icon: 'rate_review', tone: '#c084fc', helper: 'Review column not already done', ariaLabel: 'Review task count' },
  ]

  return { total, done, boardDone, agentDone, review, blocked, inProgress, dueSoon, open, progress, columnCounts, stats, columns: trackedColumns }
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
              <p className="text-[10px] font-label uppercase tracking-[0.18em] text-on-surface-variant">Actually done</p>
              <p aria-label="Done task progress" className="mt-2 text-3xl font-headline font-bold text-on-surface md:text-4xl">
                {summary.done} / {summary.total}
              </p>
              <p className="mt-1 text-xs text-on-surface-variant">Done column, completed tasks, and agent-done work</p>
            </div>
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#4ade8040] bg-[#4ade8016] text-[#4ade80]">
              <span aria-hidden="true" data-icon="fact_check" className="material-symbols-outlined text-[24px] before:content-[attr(data-icon)]" />
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
              <span aria-hidden="true" data-icon="event" className="material-symbols-outlined text-[14px] before:content-[attr(data-icon)]" />
              {summary.dueSoon} due this week
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-card-border)] px-2 py-1">
              <span aria-hidden="true" data-icon="pending_actions" className="material-symbols-outlined text-[14px] before:content-[attr(data-icon)]" />
              {summary.open} still open
            </span>
          </div>
        </div>

          <div className="p-3 md:p-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {summary.stats.map(stat => (
              <div
                key={stat.key}
                className="relative overflow-hidden rounded-2xl border border-[var(--color-card-border)] bg-[color-mix(in_srgb,var(--color-card)_82%,black)] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
              >
                <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: stat.tone }} />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{stat.label}</span>
                  <span aria-hidden="true" data-icon={stat.icon} className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.04] material-symbols-outlined text-[16px] before:content-[attr(data-icon)]" style={{ color: stat.tone }} />
                </div>
                <p aria-label={stat.ariaLabel} className="mt-3 text-3xl font-headline font-bold leading-none text-on-surface">{stat.value}</p>
                <p className="mt-2 min-h-[2.25rem] text-[11px] leading-4 text-on-surface-variant">{stat.helper}</p>
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
