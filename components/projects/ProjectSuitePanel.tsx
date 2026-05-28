'use client'

import { useEffect, useMemo, useState } from 'react'

type SuiteItem = {
  id?: string
  title?: string
  description?: string
  status?: string
  severity?: string
  dueDate?: unknown
  ownerUid?: string
  internalOnly?: boolean
}

type ProjectHealth = {
  level?: string
  score?: number
  blockedTasks?: number
  overdueTasks?: number
  waitingApprovals?: number
  milestoneDrift?: number
}

type SuiteData = {
  health?: ProjectHealth
  milestones: SuiteItem[]
  approvals: SuiteItem[]
  risks: SuiteItem[]
  decisions: SuiteItem[]
}

const EMPTY_SUITE: SuiteData = {
  milestones: [],
  approvals: [],
  risks: [],
  decisions: [],
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

function formatDate(value: unknown): string {
  const millis = timestampToMillis(value)
  if (!millis) return 'No due date'
  return new Date(millis).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function labelStatus(value?: string): string {
  return (value || 'active').replace(/_/g, ' ')
}

function HealthMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] px-4 py-3">
      <p className="text-2xl font-headline font-bold text-on-surface">{value}</p>
      <p className="mt-1 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</p>
    </div>
  )
}

function ItemList({ title, emptyLabel, items }: { title: string; emptyLabel: string; items: SuiteItem[] }) {
  return (
    <section className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-headline font-semibold text-on-surface">{title}</h3>
        <span className="rounded-full border border-[var(--color-card-border)] px-2 py-0.5 text-[10px] font-label text-on-surface-variant">
          {items.length}
        </span>
      </div>
      <div className="space-y-2">
        {items.length === 0 ? <p className="text-sm text-on-surface-variant">{emptyLabel}</p> : null}
        {items.map((item, index) => (
          <article key={item.id || `${title}-${index}`} className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2">
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
              {item.internalOnly ? (
                <span className="inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">lock</span>
                  Internal
                </span>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

export function ProjectSuitePanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<SuiteData>(EMPTY_SUITE)
  const [loading, setLoading] = useState(true)
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

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setLoading(true)
    })
    fetch(`/api/v1/projects/${projectId}/suite`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || 'Project suite failed to load')
        const next = body.data ?? {}
        if (!cancelled) {
          setData({
            health: next.health ?? {},
            milestones: Array.isArray(next.milestones) ? next.milestones : [],
            approvals: Array.isArray(next.approvals) ? next.approvals : [],
            risks: Array.isArray(next.risks) ? next.risks : [],
            decisions: Array.isArray(next.decisions) ? next.decisions : [],
          })
          setError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Project suite failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [projectId])

  return (
    <div className="flex-1 overflow-auto pb-6">
      <div className="max-w-6xl space-y-5">
        <section className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-5 shadow-sm">
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
          {error ? <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
        </section>

        <div className="grid gap-4 xl:grid-cols-2">
          <ItemList title="Milestones" emptyLabel="No milestones yet." items={data.milestones} />
          <ItemList title="Approvals" emptyLabel="No approval gates yet." items={data.approvals} />
          <ItemList title="Risk log" emptyLabel="No active risks logged." items={data.risks} />
          <ItemList title="Decision log" emptyLabel="No decisions recorded yet." items={data.decisions} />
        </div>
      </div>
    </div>
  )
}
