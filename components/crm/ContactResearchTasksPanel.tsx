'use client'

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@/components/studio'

export type ResearchTaskRow = {
  id: string
  kind?: string
  status?: string
  reason?: string
  priority?: number
  budgetUnits?: number
  budgetSpent?: number
  dueAt?: unknown
  resultSummary?: string | null
  lastError?: string | null
  leaseOwner?: string | null
}

function statusTone(status?: string): string {
  switch (status) {
    case 'pending':
      return 'text-[var(--st-warning)] border-amber-500/30 bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)]'
    case 'leased':
      return 'text-sky-200 border-sky-500/30 bg-sky-500/10'
    case 'done':
      return 'text-emerald-200 border-emerald-500/30 bg-emerald-500/10'
    case 'failed':
      return 'text-red-200 border-red-500/30 bg-red-500/10'
    case 'cancelled':
      return 'text-[var(--color-pib-text-muted)] border-[var(--color-pib-line)] bg-black/10'
    default:
      return 'text-[var(--color-pib-text-muted)] border-[var(--color-pib-line)] bg-black/10'
  }
}

function formatWhen(value: unknown): string {
  if (!value) return ' - '
  try {
    if (typeof value === 'string' || typeof value === 'number') {
      const d = new Date(value)
      return Number.isNaN(d.getTime()) ? ' - ' : d.toLocaleString()
    }
    if (typeof value === 'object') {
      const v = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
      if (typeof v.toDate === 'function') return v.toDate().toLocaleString()
      const seconds = v.seconds ?? v._seconds
      if (typeof seconds === 'number') return new Date(seconds * 1000).toLocaleString()
    }
  } catch {
    return ' - '
  }
  return ' - '
}

export function ContactResearchTasksPanel({
  contactId,
  contactName,
  apiPath,
}: {
  contactId: string
  contactName: string
  apiPath: (path: string) => string
}) {
  const [tasks, setTasks] = useState<ResearchTaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [includeDone, setIncludeDone] = useState(false)

  const load = useCallback(async () => {
    if (!contactId) return
    setLoading(true)
    setError(null)
    try {
      // Fetch without a single status filter so leased/failed open work is visible.
      // listResearchTasks only supports one status equality at a time.
      const qs = new URLSearchParams({
        contactId,
        limit: includeDone ? '40' : '30',
      })
      const res = await fetch(apiPath(`/api/v1/crm/research-tasks?${qs.toString()}`))
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error || 'Failed to load research queue')
        setTasks([])
        return
      }
      const rows = (body?.data?.tasks ?? body?.tasks ?? body?.data ?? []) as ResearchTaskRow[]
      const list = Array.isArray(rows) ? rows : []
      setTasks(
        includeDone
          ? list
          : list.filter((t) => t.status === 'pending' || t.status === 'leased' || t.status === 'failed'),
      )
    } catch {
      setError('Failed to load research queue')
      setTasks([])
    } finally {
      setLoading(false)
    }
  }, [apiPath, contactId, includeDone])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section
      aria-label={`Research queue for ${contactName}`}
      className="overflow-hidden rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-pib-line)] px-5 py-3.5">
        <div>
          <p className="eyebrow !text-[10px]">Resident loop</p>
          <h3 className="mt-0.5 text-sm font-medium text-[var(--color-pib-text)]">Research queue</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIncludeDone((v) => !v)}
            className="rounded-md border border-[var(--color-pib-line)] px-2 py-1 text-[11px] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)]"
          >
            {includeDone ? 'Hide done' : 'Show all'}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh research queue"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)]"
          >
            <Icon name="refresh" className="text-[16px]" />
          </button>
        </div>
      </div>

      {error && (
        <p className="border-b border-red-500/20 bg-red-500/10 px-5 py-2 text-xs text-red-200">{error}</p>
      )}

      {loading ? (
        <div className="space-y-2 p-5">
          {[0, 1].map((i) => (
            <div key={i} className="pib-skeleton h-14" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="p-5 text-center">
          <Icon name="event_repeat" className="text-[22px] text-[var(--color-pib-text-muted)]" />
          <p className="mt-2 text-sm font-medium text-[var(--color-pib-text)]">No open research tasks</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[var(--color-pib-text-muted)]">
            Agents schedule rechecks with a rep-visible reason. The multi-machine worker leases due work,
            applies payload-backed evidence, and completes the queue.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--color-pib-line)]">
          {tasks.map((task) => (
            <article key={task.id} className="px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusTone(task.status)}`}
                >
                  {task.status || 'unknown'}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-pib-text-muted)]">
                  {task.kind || 'custom'}
                </span>
                <span className="text-[10px] text-[var(--color-pib-text-muted)]">
                  due {formatWhen(task.dueAt)}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-[var(--color-pib-text)]">{task.reason || 'No reason recorded'}</p>
              {task.resultSummary ? (
                <p className="mt-1 text-[11px] leading-5 text-[var(--color-pib-text-muted)]">
                  {task.resultSummary}
                </p>
              ) : null}
              {task.lastError ? (
                <p className="mt-1 text-[11px] text-red-200">{task.lastError}</p>
              ) : null}
              <p className="mt-1 text-[10px] text-[var(--color-pib-text-muted)]">
                budget {task.budgetSpent ?? 0}/{task.budgetUnits ?? 0}
                {task.leaseOwner ? ` · worker ${task.leaseOwner}` : ''}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
