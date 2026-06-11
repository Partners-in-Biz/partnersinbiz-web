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
  active: '#4ade80',
  paused: '#facc15',
  cancelled: 'var(--color-outline)',
  completed: '#60a5fa',
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/portal/invoicing" className="text-xs text-on-surface-variant hover:text-on-surface transition-colors">← Invoicing</Link>
          <h1 className="text-2xl font-headline font-bold text-on-surface mt-1">Recurring Schedules</h1>
        </div>
        <div className="flex gap-2">
          {(['active', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs font-label px-3 py-1.5 rounded-full capitalize transition-colors ${filter === f ? 'bg-[var(--color-accent-v2)] text-white' : 'pib-btn-secondary'}`}
            >
              {f === 'all' ? 'All' : 'Active'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : schedules.length === 0 ? (
        <div className="pib-card py-12 text-center">
          <p className="text-on-surface-variant text-sm">No recurring schedules found.</p>
        </div>
      ) : (
        <div className="pib-card divide-y divide-[var(--color-card-border)]">
          {schedules.map(s => {
            const color = STATUS_COLORS[s.status] ?? 'var(--color-outline)'
            return (
              <div key={s.id} className="flex items-center justify-between py-3 px-1">
                <div className="flex items-center gap-4">
                  <span className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: `${color}20`, color }}>
                    {s.status}
                  </span>
                  <div>
                    <Link href={`/portal/invoicing/${s.invoiceId}`} className="text-sm font-medium text-on-surface hover:underline">
                      Invoice ↗
                    </Link>
                    <p className="text-xs text-on-surface-variant">{INTERVAL_LABELS[s.interval] ?? s.interval} · Next: {formatDate(s.nextDueAt)}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {s.status === 'active' && (
                    <button
                      onClick={() => updateScheduleStatus(s.id, 'paused')}
                      disabled={updating === s.id}
                      className="pib-btn-secondary text-xs font-label"
                    >
                      Pause
                    </button>
                  )}
                  {s.status === 'paused' && (
                    <button
                      onClick={() => updateScheduleStatus(s.id, 'active')}
                      disabled={updating === s.id}
                      className="pib-btn-primary text-xs font-label"
                    >
                      Resume
                    </button>
                  )}
                  {(s.status === 'active' || s.status === 'paused') && (
                    <button
                      onClick={() => updateScheduleStatus(s.id, 'cancelled')}
                      disabled={updating === s.id}
                      className="pib-btn-secondary text-xs font-label"
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
