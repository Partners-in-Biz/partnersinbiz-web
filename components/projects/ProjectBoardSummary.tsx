'use client'

import { Icon } from '@/components/studio'
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
    { key: 'blocked', label: 'Needs Peet', value: blocked, icon: 'person_alert', tone: '#ef4444', helper: 'Active blocked/waiting on approval/input', ariaLabel: 'Needs Peet task count' },
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
      data-module-accent="cyan"
      className="pib-card mb-2.5 shrink-0 overflow-hidden !p-0 md:mb-3"
    >
      <div className="grid gap-0 md:grid-cols-[minmax(200px,0.8fr)_minmax(0,1.65fr)]">
        <div className="border-b border-[var(--color-pib-line)] p-3 md:border-b-0 md:border-r md:p-3.5">
          <div className="flex items-start justify-between gap-2.5">
            <div>
              <p className="pib-label">Actually done</p>
              <p aria-label="Done task progress" className="mt-1 text-2xl font-headline font-medium tabular-nums text-[var(--color-pib-text)] md:text-3xl">
                {summary.done} / {summary.total}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--color-pib-text-muted)]">Done column, completed tasks, and agent-done work</p>
            </div>
            <span className="shrink-0" aria-hidden="true">
              <Icon name="fact_check" />
            </span>
          </div>

          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-[var(--color-pib-text-muted)]">
              <span>Completion</span>
              <span className="font-mono">{summary.progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-md bg-black/20">
              <div className="h-full rounded-md bg-[#4ade80] transition-all" style={{ width: `${summary.progress}%` }} />
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px] text-[var(--color-pib-text-muted)]">
            <span className="inline-flex items-center gap-1 rounded-md border border-[var(--color-pib-line)] px-2 py-0.5">
              <Icon name="event" />
              {summary.dueSoon} due this week
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-[var(--color-pib-line)] px-2 py-0.5">
              <Icon name="pending_actions" />
              {summary.open} still open
            </span>
          </div>
        </div>

        <div className="p-2.5 md:p-3">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-5">
            {summary.stats.map(stat => (
              <div
                key={stat.key}
                className="pib-surface relative overflow-hidden !p-2.5"
              >
                <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: stat.tone }} />
                <div className="flex items-center justify-between gap-1.5">
                  <span className="pib-label">{stat.label}</span>
                  <span
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/[0.04]"
                    style={{ color: stat.tone }}
                  >
                    <Icon name={stat.icon} />
                  </span>
                </div>
                <p aria-label={stat.ariaLabel} className="mt-1.5 text-xl font-headline font-medium leading-none tabular-nums text-[var(--color-pib-text)]">{stat.value}</p>
                <p className="mt-1 min-h-[1.75rem] text-[10px] leading-3.5 text-[var(--color-pib-text-muted)]">{stat.helper}</p>
              </div>
            ))}
          </div>

          <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-md bg-black/20" aria-label="Board column distribution">
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

          <div className="mt-2 flex flex-wrap gap-1.5">
            {summary.columns.map(column => {
              const count = summary.columnCounts.get(column.id) ?? 0
              return (
                <span key={column.id} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-pib-line)] px-2 py-0.5 text-[10px] text-[var(--color-pib-text-muted)]">
                  <span className="h-1.5 w-1.5 rounded-md" style={{ background: column.color ?? 'var(--color-outline)' }} />
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
