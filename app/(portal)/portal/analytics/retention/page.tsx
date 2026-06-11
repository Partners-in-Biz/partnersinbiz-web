'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'

interface CohortRow {
  cohortLabel: string
  cohortSize: number
  periods: (number | null)[]
}

interface RetentionResult {
  granularity: string
  maxPeriods: number
  rows: CohortRow[]
}

function heatColor(pct: number | null): string {
  if (pct === null) return 'bg-surface-variant/20 text-on-surface-variant/40'
  if (pct >= 80) return 'bg-amber-500/80 text-amber-900 font-bold'
  if (pct >= 60) return 'bg-amber-500/60 text-amber-100 font-semibold'
  if (pct >= 40) return 'bg-amber-500/40 text-amber-200'
  if (pct >= 20) return 'bg-amber-500/20 text-amber-300'
  if (pct > 0)   return 'bg-amber-500/10 text-amber-400'
  return 'bg-transparent text-on-surface-variant/50'
}

export default function RetentionPage() {
  const sp = useSearchParams()
  const initialPid = sp?.get('propertyId') ?? ''
  const [propertyId, setPropertyId] = useState(initialPid)
  const [cohortEvent, setCohortEvent] = useState('$pageview')
  const [returnEvent, setReturnEvent] = useState('$pageview')
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10)
  })
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [granularity, setGranularity] = useState<'day' | 'week'>('week')
  const [result, setResult] = useState<RetentionResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    if (!propertyId) return
    setLoading(true); setError('')
    const params = new URLSearchParams({ propertyId, cohortEvent, returnEvent, from, to, granularity })
    const res = await fetch(`/api/v1/analytics/retention?${params}`)
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed'); setLoading(false); return }
    setResult(data.result)
    setLoading(false)
  }

  const maxPeriods = result?.maxPeriods ?? 0

  return (
    <div className="p-6 space-y-6">
      <AnalyticsNav active="retention" propertyId={propertyId} />
      <h1 className="text-2xl font-headline font-bold text-on-surface">Retention</h1>

      <div className="pib-card p-4 space-y-3">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 items-end">
        <div>
          <label className="text-xs font-label uppercase tracking-widest text-on-surface-variant block mb-1">Cohort Event</label>
          <input className="pib-input w-full" value={cohortEvent} onChange={e => setCohortEvent(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-label uppercase tracking-widest text-on-surface-variant block mb-1">Return Event</label>
          <input className="pib-input w-full" value={returnEvent} onChange={e => setReturnEvent(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-label uppercase tracking-widest text-on-surface-variant block mb-1">From</label>
          <input className="pib-input w-full" type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-label uppercase tracking-widest text-on-surface-variant block mb-1">To</label>
          <input className="pib-input w-full" type="date" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-label uppercase tracking-widest text-on-surface-variant block mb-1">Granularity</label>
          <select className="pib-input w-full" value={granularity} onChange={e => setGranularity(e.target.value as 'day' | 'week')}>
            <option value="day">Day</option>
            <option value="week">Week</option>
          </select>
        </div>
        <div className="md:col-span-3">
          <button className="pib-btn-primary w-full" onClick={load} disabled={!propertyId || loading}>
            {loading ? 'Computing…' : 'Compute Retention'}
          </button>
        </div>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {result && result.rows.length === 0 && (
        <p className="text-on-surface-variant text-sm">No cohort data found for this range.</p>
      )}

      {result && result.rows.length > 0 && (
        <div className="pib-card overflow-x-auto">
          <table className="text-xs w-full border-collapse">
            <thead>
              <tr className="text-on-surface-variant">
                <th className="text-left p-2 pr-4 font-label uppercase tracking-widest whitespace-nowrap">Cohort</th>
                <th className="text-right p-2 font-label uppercase tracking-widest">Users</th>
                {[...Array(maxPeriods)].map((_, i) => (
                  <th key={i} className="p-2 font-label uppercase tracking-widest text-center min-w-[48px]">
                    {granularity === 'day' ? `Day ${i}` : `Wk ${i}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map(row => (
                <tr key={row.cohortLabel} className="border-t border-[var(--color-card-border)]">
                  <td className="p-2 pr-4 font-mono whitespace-nowrap text-on-surface">{row.cohortLabel}</td>
                  <td className="p-2 text-right text-on-surface-variant">{row.cohortSize.toLocaleString()}</td>
                  {row.periods.map((pct, i) => (
                    <td key={i} className={`p-2 text-center rounded-sm m-0.5 ${heatColor(pct)}`}>
                      {pct !== null ? `${pct}%` : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
