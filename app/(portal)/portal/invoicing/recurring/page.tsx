'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { INTERVAL_LABELS, RecurrenceInterval } from '@/lib/invoices/recurring'

interface Schedule {
  id: string
  invoiceId: string
  orgId: string
  interval: RecurrenceInterval
  startDate: any
  endDate: any
  nextDueAt: any
  status: 'active' | 'paused' | 'cancelled' | 'completed'
  invoiceNumber?: string
}

function formatDate(ts: any) {
  if (!ts) return '—'
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

const STATUS_COLORS: Record<string, string> = {
  active: 'pib-pill pib-pill-success',
  paused: 'pib-pill pib-pill-warn',
  cancelled: 'pib-pill',
  completed: 'pib-pill pib-pill-blue',
}

export default function RecurringSchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'active' | 'all'>('active')
  const [updating, setUpdating] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/v1/recurring-schedules?status=${filter}`)
      .then(r => r.json())
      .then(body => { setSchedules(body.data ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [filter])

  async function updateScheduleStatus(id: string, status: 'active' | 'paused' | 'cancelled') {
    setUpdating(id)
    const res = await fetch(`/api/v1/recurring-schedules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      setSchedules(prev => prev.map(s => s.id === id ? { ...s, status } : s))
    }
    setUpdating(null)
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/portal/invoicing" className="text-xs text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)]">← Invoicing</Link>
          <p className="eyebrow mt-3">Invoicing · Recurring</p>
          <h1 className="pib-page-title mt-2">Recurring Schedules</h1>
        </div>
        <div role="tablist" aria-label="Schedule filter" className="pib-tabs pib-tabs-segmented">
          {(['active', 'all'] as const).map(f => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`pib-tab capitalize ${filter === f ? 'pib-tab-active' : ''}`}
            >
              {f === 'all' ? 'All' : 'Active'}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : schedules.length === 0 ? (
        <div className="pib-empty-state">
          <span aria-hidden="true" className="material-symbols-outlined pib-empty-state-icon">event_repeat</span>
          <h2 className="pib-empty-state-title">No recurring schedules found.</h2>
        </div>
      ) : (
        <div className="pib-surface pib-surface-list divide-y divide-[var(--color-pib-line)]">
          {schedules.map(s => {
            const pill = STATUS_COLORS[s.status] ?? 'pib-pill'
            return (
              <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-[var(--color-row-hover)]">
                <div className="flex items-center gap-4">
                  <span className="pib-icon-tint pib-icon-tint-cyan" aria-hidden="true">
                    <span className="material-symbols-outlined text-[18px]">event_repeat</span>
                  </span>
                  <span className={pill}>
                    {s.status}
                  </span>
                  <div>
                    <Link href={`/portal/invoicing/${s.invoiceId}`} className="text-sm font-medium hover:underline">
                      Invoice ↗
                    </Link>
                    <p className="text-xs text-[var(--color-pib-text-muted)]">{INTERVAL_LABELS[s.interval] ?? s.interval} · Next: {formatDate(s.nextDueAt)}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {s.status === 'active' && (
                    <button
                      onClick={() => updateScheduleStatus(s.id, 'paused')}
                      disabled={updating === s.id}
                      className="btn-pib-secondary"
                    >
                      Pause
                    </button>
                  )}
                  {s.status === 'paused' && (
                    <button
                      onClick={() => updateScheduleStatus(s.id, 'active')}
                      disabled={updating === s.id}
                      className="btn-pib-primary"
                    >
                      Resume
                    </button>
                  )}
                  {(s.status === 'active' || s.status === 'paused') && (
                    <button
                      onClick={() => updateScheduleStatus(s.id, 'cancelled')}
                      disabled={updating === s.id}
                      className="btn-pib-ghost"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
