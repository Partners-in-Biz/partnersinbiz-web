'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type SuiteItem = {
  id?: string
  title?: string
  description?: string
  status?: string
  severity?: string
  dueDate?: unknown
  startDate?: unknown
  baselineDueDate?: unknown
  baselineDriftDays?: number
  dependsOn?: string[]
  cadence?: string
  trigger?: string
  templateKind?: string
  recurrenceRule?: string
  nextRunAt?: unknown
  autoCreateTasks?: boolean
  templateSteps?: string[]
  notificationChannels?: string[]
  itemType?: string
  itemId?: string
  eventType?: string
  enabled?: boolean
  allowedUserIds?: string[]
  allowedOrgIds?: string[]
  allowedRoleIds?: string[]
  recipientUserIds?: string[]
  recipientOrgIds?: string[]
  recipientRoleIds?: string[]
  permissionPolicyIds?: string[]
  uid?: string
  displayName?: string
  capacityMinutes?: number
  amount?: number
  currency?: string
  ownerUid?: string
  actorName?: string
  channel?: string
  visibility?: string
  internalOnly?: boolean
}

type TimelineItem = SuiteItem & {
  kind?: string
  dependencies?: string[]
}

type WorkloadAssignee = {
  uid?: string
  name?: string
  assignedTasks?: number
  estimateMinutes?: number
  capacityMinutes?: number
  utilizationPercent?: number
  overCapacity?: boolean
  remainingMinutes?: number
  overByMinutes?: number
}

type ProjectHealth = {
  level?: string
  score?: number
  blockedTasks?: number
  overdueTasks?: number
  waitingApprovals?: number
  milestoneDrift?: number
}

type ProjectReports = {
  tasks?: { total?: number; open?: number; done?: number; blocked?: number; overdue?: number }
  milestones?: { total?: number; drift?: number }
  approvals?: { total?: number; waiting?: number }
  risks?: { total?: number; high?: number; open?: number }
  revenue?: { trackedAmount?: number; currency?: string; records?: number }
}

type SuiteData = {
  health?: ProjectHealth
  timeline?: { items?: TimelineItem[]; driftCount?: number; dependencyCount?: number; baselines?: SuiteItem[] }
  workload?: { assignees?: WorkloadAssignee[]; totalEstimateMinutes?: number; totalCapacityMinutes?: number; totalRemainingMinutes?: number; totalOverByMinutes?: number; averageUtilizationPercent?: number; overCapacityCount?: number }
  reports?: ProjectReports
  milestones: SuiteItem[]
  approvals: SuiteItem[]
  risks: SuiteItem[]
  decisions: SuiteItem[]
  baselines: SuiteItem[]
  playbooks: SuiteItem[]
  automations: SuiteItem[]
  permissions: SuiteItem[]
  audit: SuiteItem[]
  notificationSettings: SuiteItem[]
  capacities: SuiteItem[]
  revenue: SuiteItem[]
}

const EMPTY_SUITE: SuiteData = {
  milestones: [],
  approvals: [],
  risks: [],
  decisions: [],
  baselines: [],
  playbooks: [],
  automations: [],
  permissions: [],
  audit: [],
  notificationSettings: [],
  capacities: [],
  revenue: [],
}

function timestampToMillis(value: unknown): number {
  if (!value) return 0
  if (typeof value === 'number' && Number.isFinite(value)) return value
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

function formatDate(value: unknown): string {
  const millis = timestampToMillis(value)
  if (!millis) return 'No due date'
  return new Date(millis).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function labelStatus(value?: string): string {
  return (value || 'active').replace(/_/g, ' ')
}

function formatMinutes(value?: number): string {
  const minutes = typeof value === 'number' ? value : 0
  if (minutes < 60) return `${minutes}m`
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
}

function formatMoney(amount?: number, currency?: string): string {
  const value = typeof amount === 'number' ? amount : 0
  return `${currency || 'ZAR'} ${Math.round(value).toLocaleString()}`
}

function dateInputValue(value: unknown): string {
  const millis = timestampToMillis(value)
  if (!millis) return ''
  return new Date(millis).toISOString().slice(0, 10)
}

function csvToIds(value: string): string[] {
  return Array.from(new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ))
}

type TimelineDraft = {
  title: string
  startDate: string
  dueDate: string
  baselineDueDate: string
  dependsOn: string
  visibility: string
}

const EMPTY_TIMELINE_DRAFT: TimelineDraft = {
  title: '',
  startDate: '',
  dueDate: '',
  baselineDueDate: '',
  dependsOn: '',
  visibility: 'project',
}

function draftFromTimelineItem(item: TimelineItem): TimelineDraft {
  return {
    title: item.title || '',
    startDate: dateInputValue(item.startDate),
    dueDate: dateInputValue(item.dueDate),
    baselineDueDate: dateInputValue(item.baselineDueDate),
    dependsOn: (item.dependencies || item.dependsOn || []).join(', '),
    visibility: item.visibility || 'project',
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

function itemStartMillis(item: TimelineItem): number {
  return timestampToMillis(item.startDate) || timestampToMillis(item.dueDate)
}

function itemDueMillis(item: TimelineItem): number {
  return timestampToMillis(item.dueDate) || timestampToMillis(item.startDate)
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

function offsetPercent(value: number, min: number, span: number): number {
  return clampPercent(((value - min) / span) * 100)
}

function widthPercent(start: number, end: number, span: number): number {
  return Math.max(6, clampPercent(((Math.max(end, start) - start || DAY_MS) / span) * 100))
}

function HealthMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-4 py-3">
      <p className="text-2xl font-headline font-bold text-on-surface">{value}</p>
      <p className="mt-1 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</p>
    </div>
  )
}

function TimelineGantt({ items, onEditItem }: { items: TimelineItem[]; onEditItem?: (item: TimelineItem) => void }) {
  const dated = items
    .map((item) => {
      const start = itemStartMillis(item)
      const due = itemDueMillis(item)
      const baselineDue = timestampToMillis(item.baselineDueDate)
      return { item, start, due, baselineDue }
    })
    .filter((entry) => entry.start || entry.due)

  if (dated.length === 0) return null

  const minDate = Math.min(...dated.flatMap((entry) => [entry.start, entry.baselineDue || entry.start].filter(Boolean)))
  const maxDate = Math.max(...dated.flatMap((entry) => [entry.due, entry.baselineDue || entry.due].filter(Boolean)))
  const span = Math.max(maxDate - minDate, DAY_MS)

  return (
    <div aria-label="Project Gantt timeline" className="mb-4 rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-headline font-semibold text-on-surface">Timeline Gantt</h4>
          <p className="mt-1 text-xs text-on-surface-variant">{formatDate(minDate)} - {formatDate(maxDate)}</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-on-surface-variant">
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-5 rounded-full bg-[var(--color-primary)]" />
            Actual
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-5 border-t border-dashed border-[#f59e0b]" />
            Baseline
          </span>
        </div>
      </div>
      <div className="space-y-3">
        {dated.map(({ item, start, due, baselineDue }) => {
          const title = item.title || 'Untitled'
          const dependencies = item.dependencies || item.dependsOn || []
          const left = offsetPercent(start, minDate, span)
          const width = widthPercent(start, due, span)
          const baselineLeft = baselineDue ? offsetPercent(baselineDue, minDate, span) : null
          const drift = typeof item.baselineDriftDays === 'number' && item.baselineDriftDays > 0 ? item.baselineDriftDays : 0

          return (
            <div key={item.id || title} className="grid gap-2 md:grid-cols-[minmax(140px,0.32fr)_minmax(0,1fr)] md:items-center">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-xs font-medium text-on-surface">{title}</p>
                  {onEditItem ? (
                    <button
                      type="button"
                      aria-label={`Edit Gantt ${title}`}
                      onClick={() => onEditItem(item)}
                      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-[var(--color-card-border)] text-on-surface-variant hover:border-[var(--color-primary)] hover:text-on-surface"
                    >
                      <span className="material-symbols-outlined text-[14px]" aria-hidden="true">edit</span>
                    </button>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[11px] capitalize text-on-surface-variant">{item.kind || 'item'} / {formatDate(due)}</p>
              </div>
              <div className="min-w-0">
                <div className="relative h-8 rounded-md bg-[var(--color-background)]">
                  {baselineLeft !== null ? (
                    <span
                      className="absolute top-1 h-6 border-l border-dashed border-[#f59e0b]"
                      style={{ left: `${baselineLeft}%` }}
                      title={`Baseline ${formatDate(baselineDue)}`}
                    />
                  ) : null}
                  <span
                    aria-label={`${title} Gantt bar`}
                    className="absolute top-2 h-4 rounded-full bg-[var(--color-primary)] shadow-sm"
                    style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                  />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-on-surface-variant">
                  {baselineDue ? <span>Baseline {formatDate(baselineDue)}</span> : null}
                  <span>Due {formatDate(due)}</span>
                  {drift > 0 ? <span className="text-[#f59e0b]">Drift {drift}d</span> : null}
                  {dependencies.length > 0 ? <span>Depends on {dependencies.join(', ')}</span> : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TimelinePanel({
  timeline,
  baselines,
  onCreateMilestone,
  onUpdateTimelineItem,
  saving,
}: {
  timeline?: SuiteData['timeline']
  baselines: SuiteItem[]
  onCreateMilestone: (draft: TimelineDraft) => Promise<void>
  onUpdateTimelineItem: (item: TimelineItem, draft: TimelineDraft) => Promise<void>
  saving: boolean
}) {
  const items = Array.isArray(timeline?.items) ? timeline.items : []
  const [draft, setDraft] = useState<TimelineDraft>(EMPTY_TIMELINE_DRAFT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<TimelineDraft>(EMPTY_TIMELINE_DRAFT)
  function startEditing(item: TimelineItem) {
    setEditingId(item.id || null)
    setEditDraft(draftFromTimelineItem(item))
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-card-border)] bg-[var(--color-background)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-headline font-semibold text-on-surface">Timeline</h3>
          <p className="mt-1 text-xs text-on-surface-variant">Baseline drift: {timeline?.driftCount ?? 0} items / {timeline?.dependencyCount ?? 0} dependencies</p>
        </div>
        <span className="rounded-full border border-[var(--color-card-border)] px-2 py-0.5 text-[10px] font-label text-on-surface-variant">Baseline drift</span>
      </div>
      <TimelineGantt items={items} onEditItem={startEditing} />
      <div className="space-y-2">
        {items.length === 0 ? <p className="text-sm text-on-surface-variant">No timeline items yet.</p> : null}
        {items.map((item, index) => (
          <article key={item.id || `timeline-${index}`} className="rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-on-surface">{item.title || 'Untitled'}</p>
                <p className="mt-1 text-xs capitalize text-on-surface-variant">{item.kind || 'item'} / {formatDate(item.startDate)} - {formatDate(item.dueDate)}</p>
              </div>
              <span className="rounded-full border border-[var(--color-card-border)] px-2 py-0.5 text-[10px] text-on-surface-variant">
                {item.baselineDriftDays && item.baselineDriftDays > 0 ? `${item.baselineDriftDays}d drift` : 'On baseline'}
              </span>
            </div>
            {Array.isArray(item.dependencies) && item.dependencies.length > 0 ? (
              <p className="mt-2 text-[11px] text-on-surface-variant">{item.dependencies.length} dependencies</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="pib-btn-secondary px-3 py-1 text-[11px] font-label"
                aria-label={`Edit ${item.title || 'timeline item'}`}
                onClick={() => startEditing(item)}
              >
                Edit
              </button>
            </div>
            {editingId && editingId === item.id ? (
              <form
                className="mt-3 grid gap-2 rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] p-3 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  onUpdateTimelineItem(item, editDraft).then(() => setEditingId(null)).catch(() => {})
                }}
              >
                <label className="sm:col-span-2">
                  <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Edit timeline title</span>
                  <input value={editDraft.title} onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface" />
                </label>
                <label>
                  <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Edit timeline start date</span>
                  <input type="date" value={editDraft.startDate} onChange={(event) => setEditDraft({ ...editDraft, startDate: event.target.value })} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface" />
                </label>
                <label>
                  <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Edit timeline due date</span>
                  <input type="date" value={editDraft.dueDate} onChange={(event) => setEditDraft({ ...editDraft, dueDate: event.target.value })} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface" />
                </label>
                <label>
                  <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Edit timeline baseline due date</span>
                  <input type="date" value={editDraft.baselineDueDate} onChange={(event) => setEditDraft({ ...editDraft, baselineDueDate: event.target.value })} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface" />
                </label>
                <label>
                  <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Edit timeline dependencies</span>
                  <input value={editDraft.dependsOn} onChange={(event) => setEditDraft({ ...editDraft, dependsOn: event.target.value })} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface" />
                </label>
                <label>
                  <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Edit visibility</span>
                  <select value={editDraft.visibility} onChange={(event) => setEditDraft({ ...editDraft, visibility: event.target.value })} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface">
                    <option value="project">Project</option>
                    <option value="restricted">Restricted</option>
                    <option value="internal">Internal</option>
                    <option value="external">External</option>
                  </select>
                </label>
                <div className="flex items-end gap-2">
                  <button type="submit" className="pib-btn-primary text-xs font-label" disabled={saving || !editDraft.title.trim()}>Save timeline changes</button>
                  <button type="button" className="pib-btn-secondary text-xs font-label" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </form>
            ) : null}
          </article>
        ))}
      </div>
      <form
        className="mt-4 grid gap-2 rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] p-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          onCreateMilestone(draft)
            .then(() => setDraft(EMPTY_TIMELINE_DRAFT))
            .catch(() => {})
        }}
      >
        <h4 className="text-sm font-headline font-semibold text-on-surface sm:col-span-2">Add timeline item</h4>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">New timeline title</span>
          <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
        </label>
        <label>
          <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Timeline start date</span>
          <input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
        </label>
        <label>
          <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Timeline due date</span>
          <input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
        </label>
        <label>
          <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Timeline baseline due date</span>
          <input type="date" value={draft.baselineDueDate} onChange={(event) => setDraft({ ...draft, baselineDueDate: event.target.value })} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
        </label>
        <label>
          <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Timeline dependencies</span>
          <input value={draft.dependsOn} onChange={(event) => setDraft({ ...draft, dependsOn: event.target.value })} placeholder="task-1, milestone-1" className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
        </label>
        <label>
          <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Timeline visibility</span>
          <select value={draft.visibility} onChange={(event) => setDraft({ ...draft, visibility: event.target.value })} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface">
            <option value="project">Project</option>
            <option value="restricted">Restricted</option>
            <option value="internal">Internal</option>
            <option value="external">External</option>
          </select>
        </label>
        <div className="flex items-end">
          <button type="submit" className="pib-btn-primary text-xs font-label" disabled={saving || !draft.title.trim()}>Save timeline item</button>
        </div>
      </form>
      {baselines.length > 0 ? (
        <div className="mt-3 border-t border-[var(--color-card-border)] pt-3">
          <p className="mb-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Baselines</p>
          <div className="flex flex-wrap gap-2">
            {baselines.map((baseline) => (
              <span key={baseline.id || baseline.title} className="rounded-full border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-1 text-xs text-on-surface">
                {baseline.title || 'Project baseline'}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function WorkloadPanel({ workload }: { workload?: SuiteData['workload'] }) {
  const assignees = Array.isArray(workload?.assignees) ? workload.assignees : []
  const totalOverByMinutes = workload?.totalOverByMinutes ?? 0
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-card-border)] bg-[var(--color-background)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-headline font-semibold text-on-surface">Workload</h3>
          <p className="mt-1 text-xs text-on-surface-variant">
            <span>Capacity</span>: {formatMinutes(workload?.totalEstimateMinutes)} planned / {formatMinutes(workload?.totalCapacityMinutes)} available
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--color-card-border)] px-2 py-0.5 text-[10px] font-label text-on-surface-variant">
            {workload?.overCapacityCount ?? 0} over capacity
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-label ${totalOverByMinutes > 0 ? 'border-red-400/40 text-red-300' : 'border-[var(--color-card-border)] text-on-surface-variant'}`}>
            {totalOverByMinutes > 0 ? `${formatMinutes(totalOverByMinutes)} over` : `${formatMinutes(workload?.totalRemainingMinutes)} remaining`}
          </span>
        </div>
      </div>
      <div className="space-y-2">
        {assignees.length === 0 ? <p className="text-sm text-on-surface-variant">No assigned workload yet.</p> : null}
        {assignees.map((assignee) => {
          const overByMinutes = assignee.overByMinutes ?? 0
          const remainingMinutes = assignee.remainingMinutes ?? Math.max(0, (assignee.capacityMinutes ?? 0) - (assignee.estimateMinutes ?? 0))
          return (
            <article key={assignee.uid || assignee.name} className="rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-on-surface">{assignee.name || assignee.uid || 'Unassigned'}</p>
                  <p className="text-xs text-on-surface-variant">{assignee.assignedTasks ?? 0} tasks / {formatMinutes(assignee.estimateMinutes)} planned</p>
                  <p className="mt-0.5 text-[11px] text-on-surface-variant">{formatMinutes(assignee.capacityMinutes)} available</p>
                </div>
                <div className="shrink-0 text-right">
                  <span className="block text-sm font-semibold text-on-surface">{assignee.utilizationPercent ?? 0}%</span>
                  <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-label ${overByMinutes > 0 ? 'border-red-400/40 text-red-300' : 'border-[var(--color-card-border)] text-on-surface-variant'}`}>
                    {overByMinutes > 0 ? `${formatMinutes(overByMinutes)} over` : `${formatMinutes(remainingMinutes)} remaining`}
                  </span>
                </div>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-background)]">
                <div
                  className={`h-full ${assignee.overCapacity ? 'bg-red-400' : 'bg-[var(--color-primary)]'}`}
                  style={{ width: `${Math.min(100, assignee.utilizationPercent ?? 0)}%` }}
                />
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function ReportsPanel({ reports }: { reports?: ProjectReports }) {
  const revenue = reports?.revenue
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-card-border)] bg-[var(--color-background)] p-4">
      <h3 className="text-sm font-headline font-semibold text-on-surface">Project reports</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HealthMetric label="Tasks" value={reports?.tasks?.total ?? 0} />
        <HealthMetric label="Blocked" value={reports?.tasks?.blocked ?? 0} />
        <HealthMetric label="Waiting approvals" value={reports?.approvals?.waiting ?? 0} />
        <div className="rounded-[var(--radius-card)] border border-[var(--color-card-border)] bg-[var(--color-card)] px-4 py-3">
          <p className="text-lg font-headline font-bold text-on-surface">{formatMoney(revenue?.trackedAmount, revenue?.currency)}</p>
          <p className="mt-1 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Revenue</p>
        </div>
      </div>
    </section>
  )
}

function ControlForms({
  onCreateSuiteItem,
  saving,
  workload,
}: {
  onCreateSuiteItem: (payload: Record<string, unknown>) => Promise<void>
  saving: boolean
  workload?: SuiteData['workload']
}) {
  const [playbookTitle, setPlaybookTitle] = useState('')
  const [playbookCadence, setPlaybookCadence] = useState('weekly')
  const [playbookTemplateKind, setPlaybookTemplateKind] = useState('delivery')
  const [playbookRecurrenceRule, setPlaybookRecurrenceRule] = useState('FREQ=WEEKLY;INTERVAL=1')
  const [playbookNextRunAt, setPlaybookNextRunAt] = useState('')
  const [playbookTemplateSteps, setPlaybookTemplateSteps] = useState('')
  const [playbookAutoCreateTasks, setPlaybookAutoCreateTasks] = useState(false)
  const [automationTitle, setAutomationTitle] = useState('')
  const [automationTrigger, setAutomationTrigger] = useState('milestone_drift')
  const [automationChannels, setAutomationChannels] = useState('email')
  const [notificationTitle, setNotificationTitle] = useState('')
  const [notificationEvent, setNotificationEvent] = useState('approval_waiting')
  const [notificationItemType, setNotificationItemType] = useState('approval')
  const [notificationChannel, setNotificationChannel] = useState('email')
  const [notificationRecipients, setNotificationRecipients] = useState('manager')
  const [notificationEnabled, setNotificationEnabled] = useState(false)
  const [permissionTitle, setPermissionTitle] = useState('')
  const [permissionTargetType, setPermissionTargetType] = useState('milestone')
  const [permissionTargetId, setPermissionTargetId] = useState('')
  const [permissionVisibility, setPermissionVisibility] = useState('restricted')
  const [permissionUsers, setPermissionUsers] = useState('')
  const [permissionOrgs, setPermissionOrgs] = useState('')
  const [permissionRoles, setPermissionRoles] = useState('manager')
  const [capacityUid, setCapacityUid] = useState('')
  const [capacityMinutes, setCapacityMinutes] = useState('2400')
  const [revenueTitle, setRevenueTitle] = useState('')
  const [revenueAmount, setRevenueAmount] = useState('')
  const [revenueCurrency, setRevenueCurrency] = useState('ZAR')

  const capacityAssignees = Array.isArray(workload?.assignees) ? workload.assignees.filter((assignee) => assignee.uid) : []

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-card-border)] bg-[var(--color-background)] p-4">
      <div className="mb-3">
        <h3 className="text-sm font-headline font-semibold text-on-surface">Plan controls</h3>
        <p className="mt-1 text-xs text-on-surface-variant">Templates, automations, capacity, revenue, notifications, and item access rules.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <form
          className="rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] p-3"
          onSubmit={(event) => {
            event.preventDefault()
            onCreateSuiteItem({
              type: 'playbook',
              title: playbookTitle,
              cadence: playbookCadence,
              templateKind: playbookTemplateKind,
              recurrenceRule: playbookRecurrenceRule,
              nextRunAt: playbookNextRunAt || null,
              autoCreateTasks: playbookAutoCreateTasks,
              templateSteps: csvToIds(playbookTemplateSteps),
              visibility: 'project',
            })
              .then(() => {
                setPlaybookTitle('')
                setPlaybookNextRunAt('')
                setPlaybookTemplateSteps('')
                setPlaybookAutoCreateTasks(false)
              })
              .catch(() => {})
          }}
        >
          <h4 className="text-xs font-headline font-semibold text-on-surface">Recurring playbook</h4>
          <label className="mt-3 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Playbook title</span>
            <input value={playbookTitle} onChange={(event) => setPlaybookTitle(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Playbook cadence</span>
            <select value={playbookCadence} onChange={(event) => setPlaybookCadence(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface">
              <option value="weekly">weekly</option>
              <option value="monthly">monthly</option>
              <option value="per_milestone">per milestone</option>
            </select>
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Playbook template</span>
            <select value={playbookTemplateKind} onChange={(event) => setPlaybookTemplateKind(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface">
              <option value="delivery">delivery</option>
              <option value="launch">launch</option>
              <option value="reporting">reporting</option>
              <option value="client_onboarding">client onboarding</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Recurrence rule</span>
            <input value={playbookRecurrenceRule} onChange={(event) => setPlaybookRecurrenceRule(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Next run date</span>
            <input type="date" value={playbookNextRunAt} onChange={(event) => setPlaybookNextRunAt(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Template steps</span>
            <input value={playbookTemplateSteps} onChange={(event) => setPlaybookTemplateSteps(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
          </label>
          <label className="mt-3 inline-flex items-center gap-2 text-xs text-on-surface">
            <input type="checkbox" checked={playbookAutoCreateTasks} onChange={(event) => setPlaybookAutoCreateTasks(event.target.checked)} className="size-4 rounded border-[var(--color-card-border)] bg-[var(--color-background)]" />
            <span>Auto-create tasks</span>
          </label>
          <button type="submit" className="pib-btn-primary mt-3 text-xs font-label" disabled={saving || !playbookTitle.trim()}>Save playbook</button>
        </form>

        <form
          className="rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] p-3"
          onSubmit={(event) => {
            event.preventDefault()
            onCreateSuiteItem({
              type: 'automation',
              title: automationTitle,
              trigger: automationTrigger,
              notificationChannels: csvToIds(automationChannels),
              visibility: 'restricted',
            })
              .then(() => setAutomationTitle(''))
              .catch(() => {})
          }}
        >
          <h4 className="text-xs font-headline font-semibold text-on-surface">Automation</h4>
          <label className="mt-3 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Automation title</span>
            <input value={automationTitle} onChange={(event) => setAutomationTitle(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Automation trigger</span>
            <select value={automationTrigger} onChange={(event) => setAutomationTrigger(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface">
              <option value="milestone_drift">milestone drift</option>
              <option value="approval_waiting">approval waiting</option>
              <option value="weekly_status">weekly status</option>
              <option value="risk_escalation">risk escalation</option>
            </select>
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Automation channels</span>
            <input value={automationChannels} onChange={(event) => setAutomationChannels(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
          </label>
          <button type="submit" className="pib-btn-primary mt-3 text-xs font-label" disabled={saving || !automationTitle.trim()}>Save automation</button>
        </form>

        <form
          className="rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] p-3"
          onSubmit={(event) => {
            event.preventDefault()
            onCreateSuiteItem({
              type: 'notification',
              title: notificationTitle,
              eventType: notificationEvent,
              itemType: notificationItemType,
              channel: notificationChannel,
              recipientRoleIds: csvToIds(notificationRecipients),
              enabled: notificationEnabled,
              visibility: 'project',
            })
              .then(() => {
                setNotificationTitle('')
                setNotificationEnabled(false)
              })
              .catch(() => {})
          }}
        >
          <h4 className="text-xs font-headline font-semibold text-on-surface">Notification control</h4>
          <label className="mt-3 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Notification title</span>
            <input value={notificationTitle} onChange={(event) => setNotificationTitle(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Notification event</span>
            <select value={notificationEvent} onChange={(event) => setNotificationEvent(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface">
              <option value="approval_waiting">approval waiting</option>
              <option value="milestone_drift">milestone drift</option>
              <option value="task_blocked">task blocked</option>
              <option value="risk_escalation">risk escalation</option>
              <option value="weekly_status">weekly status</option>
            </select>
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Notification item type</span>
            <select value={notificationItemType} onChange={(event) => setNotificationItemType(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface">
              <option value="approval">approval</option>
              <option value="milestone">milestone</option>
              <option value="task">task</option>
              <option value="risk">risk</option>
              <option value="project">project</option>
            </select>
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Notification channel</span>
            <select value={notificationChannel} onChange={(event) => setNotificationChannel(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface">
              <option value="email">email</option>
              <option value="in_app">in app</option>
              <option value="both">both</option>
            </select>
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Notification recipients</span>
            <input value={notificationRecipients} onChange={(event) => setNotificationRecipients(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
          </label>
          <label className="mt-3 inline-flex items-center gap-2 text-xs text-on-surface">
            <input type="checkbox" checked={notificationEnabled} onChange={(event) => setNotificationEnabled(event.target.checked)} className="size-4 rounded border-[var(--color-card-border)] bg-[var(--color-background)]" />
            <span>Notification enabled</span>
          </label>
          <button type="submit" className="pib-btn-primary mt-3 text-xs font-label" disabled={saving || !notificationTitle.trim()}>Save notification</button>
        </form>

        <form
          className="rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] p-3"
          onSubmit={(event) => {
            event.preventDefault()
            const selected = capacityAssignees.find((assignee) => assignee.uid === capacityUid)
            const displayName = selected?.name || capacityUid
            onCreateSuiteItem({
              type: 'capacity',
              title: `${displayName} weekly capacity`,
              uid: capacityUid,
              displayName,
              capacityMinutes: Number(capacityMinutes),
              visibility: 'internal',
            })
              .then(() => setCapacityMinutes('2400'))
              .catch(() => {})
          }}
        >
          <h4 className="text-xs font-headline font-semibold text-on-surface">Capacity plan</h4>
          <label className="mt-3 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Capacity member</span>
            <select value={capacityUid} onChange={(event) => setCapacityUid(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface">
              <option value="">Select member</option>
              {capacityAssignees.map((assignee) => (
                <option key={assignee.uid} value={assignee.uid}>
                  {assignee.name || assignee.uid}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Weekly capacity minutes</span>
            <input type="number" min="0" step="15" value={capacityMinutes} onChange={(event) => setCapacityMinutes(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
          </label>
          <button type="submit" className="pib-btn-primary mt-3 text-xs font-label" disabled={saving || !capacityUid || Number(capacityMinutes) <= 0}>Save capacity</button>
        </form>

        <form
          className="rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] p-3"
          onSubmit={(event) => {
            event.preventDefault()
            onCreateSuiteItem({
              type: 'revenue',
              title: revenueTitle,
              amount: Number(revenueAmount),
              currency: revenueCurrency,
              visibility: 'internal',
            })
              .then(() => {
                setRevenueTitle('')
                setRevenueAmount('')
              })
              .catch(() => {})
          }}
        >
          <h4 className="text-xs font-headline font-semibold text-on-surface">Revenue tracking</h4>
          <label className="mt-3 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Revenue title</span>
            <input value={revenueTitle} onChange={(event) => setRevenueTitle(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Revenue amount</span>
            <input type="number" min="0" step="1" value={revenueAmount} onChange={(event) => setRevenueAmount(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Revenue currency</span>
            <select value={revenueCurrency} onChange={(event) => setRevenueCurrency(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface">
              <option value="ZAR">ZAR</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </label>
          <button type="submit" className="pib-btn-primary mt-3 text-xs font-label" disabled={saving || !revenueTitle.trim() || Number(revenueAmount) <= 0}>Save revenue</button>
        </form>

        <form
          className="rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] p-3"
          onSubmit={(event) => {
            event.preventDefault()
            onCreateSuiteItem({
              type: 'permission',
              title: permissionTitle,
              itemType: permissionTargetType,
              itemId: permissionTargetId,
              visibility: permissionVisibility,
              allowedUserIds: csvToIds(permissionUsers),
              allowedOrgIds: csvToIds(permissionOrgs),
              allowedRoleIds: csvToIds(permissionRoles),
            })
              .then(() => {
                setPermissionTitle('')
                setPermissionTargetId('')
                setPermissionUsers('')
                setPermissionOrgs('')
              })
              .catch(() => {})
          }}
        >
          <h4 className="text-xs font-headline font-semibold text-on-surface">Access control</h4>
          <label className="mt-3 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Permission title</span>
            <input value={permissionTitle} onChange={(event) => setPermissionTitle(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Permission target type</span>
            <select value={permissionTargetType} onChange={(event) => setPermissionTargetType(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface">
              <option value="milestone">milestone</option>
              <option value="task">task</option>
              <option value="approval">approval</option>
              <option value="risk">risk</option>
              <option value="decision">decision</option>
              <option value="playbook">playbook</option>
              <option value="automation">automation</option>
              <option value="capacity">capacity</option>
              <option value="revenue">revenue</option>
            </select>
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Permission target id</span>
            <input value={permissionTargetId} onChange={(event) => setPermissionTargetId(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Permission visibility</span>
            <select value={permissionVisibility} onChange={(event) => setPermissionVisibility(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface">
              <option value="restricted">restricted</option>
              <option value="project">project</option>
              <option value="internal">internal</option>
              <option value="external">external</option>
            </select>
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Allowed users</span>
            <input value={permissionUsers} onChange={(event) => setPermissionUsers(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Allowed orgs</span>
            <input value={permissionOrgs} onChange={(event) => setPermissionOrgs(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
          </label>
          <label className="mt-2 block">
            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Allowed roles</span>
            <input value={permissionRoles} onChange={(event) => setPermissionRoles(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-on-surface" />
          </label>
          <button type="submit" className="pib-btn-primary mt-3 text-xs font-label" disabled={saving || !permissionTitle.trim()}>Save access control</button>
        </form>
      </div>
    </section>
  )
}

function ItemList({
  title,
  emptyLabel,
  items,
  type,
  onArchive,
  onRun,
  saving,
}: {
  title: string
  emptyLabel: string
  items: SuiteItem[]
  type?: string
  onArchive?: (type: string, id: string) => Promise<void>
  onRun?: (type: string, id: string) => Promise<void>
  saving?: boolean
}) {
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-card-border)] bg-[var(--color-background)] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-headline font-semibold text-on-surface">{title}</h3>
        <span className="rounded-full border border-[var(--color-card-border)] px-2 py-0.5 text-[10px] font-label text-on-surface-variant">
          {items.length}
        </span>
      </div>
      <div className="space-y-2">
        {items.length === 0 ? <p className="text-sm text-on-surface-variant">{emptyLabel}</p> : null}
        {items.map((item, index) => (
          <article key={item.id || `${title}-${index}`} className="rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-on-surface">{item.title || 'Untitled'}</p>
                {item.description ? <p className="mt-1 line-clamp-2 text-xs text-on-surface-variant">{item.description}</p> : null}
              </div>
              <span className="shrink-0 rounded-full border border-[var(--color-card-border)] px-2 py-0.5 text-[10px] capitalize text-on-surface-variant">
                {labelStatus(item.status)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-on-surface-variant">
              <span className="inline-flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">event</span>
                {formatDate(item.dueDate)}
              </span>
              {item.severity ? (
                <span className="inline-flex items-center gap-1 capitalize">
                  <span className="material-symbols-outlined text-[14px]">priority_high</span>
                  {item.severity}
                </span>
              ) : null}
              {item.visibility ? (
                <span className="inline-flex items-center gap-1 capitalize">
                  <span className="material-symbols-outlined text-[14px]">visibility</span>
                  {item.visibility}
                </span>
              ) : null}
              {item.channel ? (
                <span className="inline-flex items-center gap-1 capitalize">
                  <span className="material-symbols-outlined text-[14px]">notifications</span>
                  {item.channel}
                </span>
              ) : null}
              {item.eventType ? (
                <span className="inline-flex items-center gap-1 capitalize">
                  <span className="material-symbols-outlined text-[14px]">campaign</span>
                  {labelStatus(item.eventType)}
                </span>
              ) : null}
              {item.itemType ? (
                <span className="inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">my_location</span>
                  {item.itemId ? `${item.itemType} ${item.itemId}` : item.itemType}
                </span>
              ) : null}
              {item.trigger ? (
                <span className="inline-flex items-center gap-1 capitalize">
                  <span className="material-symbols-outlined text-[14px]">bolt</span>
                  {labelStatus(item.trigger)}
                </span>
              ) : null}
              {item.cadence ? (
                <span className="inline-flex items-center gap-1 capitalize">
                  <span className="material-symbols-outlined text-[14px]">event_repeat</span>
                  {labelStatus(item.cadence)}
                </span>
              ) : null}
              {item.templateKind ? (
                <span className="inline-flex items-center gap-1 capitalize">
                  <span className="material-symbols-outlined text-[14px]">dynamic_form</span>
                  {labelStatus(item.templateKind)}
                </span>
              ) : null}
              {item.recurrenceRule ? (
                <span className="inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">repeat</span>
                  {item.recurrenceRule}
                </span>
              ) : null}
              {item.nextRunAt ? (
                <span className="inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">today</span>
                  Next {formatDate(item.nextRunAt)}
                </span>
              ) : null}
              {Array.isArray(item.templateSteps) && item.templateSteps.length > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">checklist</span>
                  {item.templateSteps.length} steps
                </span>
              ) : null}
              {item.autoCreateTasks ? (
                <span className="inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">auto_awesome_motion</span>
                  Auto-create
                </span>
              ) : null}
              {item.capacityMinutes ? (
                <span className="inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">schedule</span>
                  {formatMinutes(item.capacityMinutes)}
                </span>
              ) : null}
              {typeof item.amount === 'number' ? (
                <span className="inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">payments</span>
                  {formatMoney(item.amount, item.currency)}
                </span>
              ) : null}
              {item.actorName ? (
                <span className="inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">history</span>
                  {item.actorName}
                </span>
              ) : null}
              {Array.isArray(item.allowedUserIds) && item.allowedUserIds.length > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">person</span>
                  {item.allowedUserIds.join(', ')}
                </span>
              ) : null}
              {Array.isArray(item.allowedOrgIds) && item.allowedOrgIds.length > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">business</span>
                  {item.allowedOrgIds.join(', ')}
                </span>
              ) : null}
              {Array.isArray(item.allowedRoleIds) && item.allowedRoleIds.length > 0 ? (
                <span className="inline-flex items-center gap-1 capitalize">
                  <span className="material-symbols-outlined text-[14px]">admin_panel_settings</span>
                  {item.allowedRoleIds.map(labelStatus).join(', ')}
                </span>
              ) : null}
              {Array.isArray(item.recipientRoleIds) && item.recipientRoleIds.length > 0 ? (
                <span className="inline-flex items-center gap-1 capitalize">
                  <span className="material-symbols-outlined text-[14px]">groups</span>
                  {item.recipientRoleIds.map(labelStatus).join(', ')}
                </span>
              ) : null}
              {typeof item.enabled === 'boolean' ? (
                <span className="inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">{item.enabled ? 'notifications_active' : 'notifications_off'}</span>
                  {item.enabled ? 'Enabled' : 'Muted'}
                </span>
              ) : null}
              {Array.isArray(item.permissionPolicyIds) && item.permissionPolicyIds.length > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">policy</span>
                  {item.permissionPolicyIds.length} policies
                </span>
              ) : null}
              {item.internalOnly ? (
                <span className="inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">lock</span>
                  Internal
                </span>
              ) : null}
            </div>
            {type && item.id && (onArchive || onRun) ? (
              <div className="mt-3 flex justify-end gap-2">
                {type === 'playbook' && onRun && Array.isArray(item.templateSteps) && item.templateSteps.length > 0 ? (
                  <button
                    type="button"
                    className="pib-btn-primary px-3 py-1 text-[11px] font-label"
                    aria-label={`Run ${item.title || 'playbook'}`}
                    disabled={saving}
                    onClick={() => {
                      onRun(type, item.id as string).catch(() => {})
                    }}
                  >
                    <span className="material-symbols-outlined text-[14px]">play_arrow</span>
                    Run
                  </button>
                ) : null}
                {onArchive ? (
                  <button
                    type="button"
                    className="pib-btn-secondary px-3 py-1 text-[11px] font-label"
                    aria-label={`Archive ${item.title || 'item'}`}
                    disabled={saving}
                    onClick={() => {
                      onArchive(type, item.id as string).catch(() => {})
                    }}
                  >
                    Archive
                  </button>
                ) : null}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}

export function ProjectSuitePanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<SuiteData>(EMPTY_SUITE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const health = data.health ?? {}
  const score = typeof health.score === 'number' ? health.score : 100
  const level = labelStatus(health.level)

  const metrics = useMemo(
    () => [
      { label: 'Blocked', value: health.blockedTasks ?? 0 },
      { label: 'Overdue', value: health.overdueTasks ?? 0 },
      { label: 'Approvals', value: health.waitingApprovals ?? 0 },
      { label: 'Milestone Drift', value: health.milestoneDrift ?? 0 },
    ],
    [health.blockedTasks, health.milestoneDrift, health.overdueTasks, health.waitingApprovals],
  )

  const loadSuite = useCallback(async (options?: { quiet?: boolean; signal?: AbortSignal }) => {
    if (!options?.quiet) setLoading(true)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/suite`, { signal: options?.signal })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Project suite failed to load')
      const next = body.data ?? {}
      setData({
        health: next.health ?? {},
        timeline: next.timeline ?? {},
        workload: next.workload ?? {},
        reports: next.reports ?? {},
        milestones: Array.isArray(next.milestones) ? next.milestones : [],
        approvals: Array.isArray(next.approvals) ? next.approvals : [],
        risks: Array.isArray(next.risks) ? next.risks : [],
        decisions: Array.isArray(next.decisions) ? next.decisions : [],
        baselines: Array.isArray(next.baselines) ? next.baselines : [],
        playbooks: Array.isArray(next.playbooks) ? next.playbooks : [],
        automations: Array.isArray(next.automations) ? next.automations : [],
        permissions: Array.isArray(next.permissions) ? next.permissions : [],
        audit: Array.isArray(next.audit) ? next.audit : [],
        notificationSettings: Array.isArray(next.notificationSettings) ? next.notificationSettings : [],
        capacities: Array.isArray(next.capacities) ? next.capacities : [],
        revenue: Array.isArray(next.revenue) ? next.revenue : [],
      })
      setError(null)
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'Project suite failed to load')
      }
    } finally {
      if (!options?.quiet) setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    const controller = new AbortController()
    loadSuite({ signal: controller.signal }).catch(() => {})
    return () => controller.abort()
  }, [loadSuite])

  async function mutateSuite(payload: Record<string, unknown>, method = 'POST') {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/suite`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Project plan update failed')
      await loadSuite({ quiet: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Project plan update failed')
      throw err
    } finally {
      setSaving(false)
    }
  }

  async function patchTaskTimelineItem(item: TimelineItem, draft: TimelineDraft) {
    if (!item.id) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/tasks/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draft.title,
          startDate: draft.startDate || null,
          dueDate: draft.dueDate || null,
          baselineDueDate: draft.baselineDueDate || null,
          dependsOn: csvToIds(draft.dependsOn),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Timeline task update failed')
      await loadSuite({ quiet: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Timeline task update failed')
      throw err
    } finally {
      setSaving(false)
    }
  }

  async function createTimelineMilestone(draft: TimelineDraft) {
    await mutateSuite({
      type: 'milestone',
      title: draft.title.trim(),
      startDate: draft.startDate || null,
      dueDate: draft.dueDate || null,
      baselineDueDate: draft.baselineDueDate || null,
      dependsOn: csvToIds(draft.dependsOn),
      visibility: draft.visibility,
    })
  }

  async function updateTimelineItem(item: TimelineItem, draft: TimelineDraft) {
    if (item.kind === 'task') {
      await patchTaskTimelineItem(item, draft)
      return
    }
    await mutateSuite({
      type: item.kind || 'milestone',
      id: item.id,
      title: draft.title.trim(),
      startDate: draft.startDate || null,
      dueDate: draft.dueDate || null,
      baselineDueDate: draft.baselineDueDate || null,
      dependsOn: csvToIds(draft.dependsOn),
      visibility: draft.visibility,
    }, 'PATCH')
  }

  async function archiveSuiteItem(type: string, id: string) {
    await mutateSuite({ type, id }, 'DELETE')
  }

  async function runSuiteItem(type: string, id: string) {
    await mutateSuite({ type, id, action: 'run' }, 'POST')
  }

  return (
    <div className="flex-1 overflow-auto pb-6">
      <div className="max-w-6xl space-y-5">
        <section className="rounded-[var(--radius-card)] border border-[var(--color-card-border)] bg-[var(--color-card)] p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Project health</p>
              <h2 className="mt-1 text-2xl font-headline font-bold text-on-surface">{score}</h2>
              <p className="mt-1 text-sm capitalize text-on-surface-variant">{loading ? 'Loading plan data...' : level}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[520px] lg:grid-cols-4">
              {metrics.map((metric) => (
                <HealthMetric key={metric.label} label={metric.label} value={metric.value} />
              ))}
            </div>
          </div>
          {error ? <p className="mt-4 rounded-[var(--radius-btn)] border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <TimelinePanel
            timeline={data.timeline}
            baselines={data.baselines}
            onCreateMilestone={createTimelineMilestone}
            onUpdateTimelineItem={updateTimelineItem}
            saving={saving}
          />
          <WorkloadPanel workload={data.workload} />
        </div>

        <ReportsPanel reports={data.reports} />

        <ControlForms onCreateSuiteItem={(payload) => mutateSuite(payload)} saving={saving} workload={data.workload} />

        <div className="grid gap-4 xl:grid-cols-2">
          <ItemList title="Milestones" emptyLabel="No milestones yet." items={data.milestones} type="milestone" onArchive={archiveSuiteItem} saving={saving} />
          <ItemList title="Approvals" emptyLabel="No approval gates yet." items={data.approvals} type="approval" onArchive={archiveSuiteItem} saving={saving} />
          <ItemList title="Risk log" emptyLabel="No active risks logged." items={data.risks} type="risk" onArchive={archiveSuiteItem} saving={saving} />
          <ItemList title="Decision log" emptyLabel="No decisions recorded yet." items={data.decisions} type="decision" onArchive={archiveSuiteItem} saving={saving} />
          <ItemList title="Playbooks" emptyLabel="No playbooks yet." items={data.playbooks} type="playbook" onArchive={archiveSuiteItem} onRun={runSuiteItem} saving={saving} />
          <ItemList title="Automations" emptyLabel="No automations yet." items={data.automations} type="automation" onArchive={archiveSuiteItem} saving={saving} />
          <ItemList title="Access controls" emptyLabel="No item-level access controls yet." items={data.permissions} type="permission" onArchive={archiveSuiteItem} saving={saving} />
          <ItemList title="Capacity plans" emptyLabel="No capacity plans yet." items={data.capacities} type="capacity" onArchive={archiveSuiteItem} saving={saving} />
          <ItemList title="Revenue tracking" emptyLabel="No revenue records yet." items={data.revenue} type="revenue" onArchive={archiveSuiteItem} saving={saving} />
          <ItemList title="Audit timeline" emptyLabel="No audit events yet." items={data.audit} />
          <ItemList title="Notifications" emptyLabel="No notification rules yet." items={data.notificationSettings} type="notification" onArchive={archiveSuiteItem} saving={saving} />
        </div>
      </div>
    </div>
  )
}
