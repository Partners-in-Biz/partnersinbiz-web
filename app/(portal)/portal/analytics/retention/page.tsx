'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { Icon } from '@/components/studio'
import { PageHeader, EmptyState } from '@/components/ui/AppFoundation'

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
  if (pct === null) return 'bg-[var(--color-pib-surface-2)] text-[var(--color-pib-text-muted)]/40'
  if (pct >= 80) return 'bg-[color-mix(in_srgb,var(--sc-accent)_80%,transparent)] text-[var(--sc-accent-ink)]'
  if (pct >= 60) return 'bg-[color-mix(in_srgb,var(--sc-accent)_60%,transparent)] text-[var(--sc-ink)]'
  if (pct >= 40) return 'bg-[color-mix(in_srgb,var(--sc-accent)_40%,transparent)] text-[var(--sc-ink)]'
  if (pct >= 20) return 'bg-[color-mix(in_srgb,var(--sc-accent)_20%,transparent)] text-[var(--sc-ink-soft)]'
  if (pct > 0)   return 'bg-[color-mix(in_srgb,var(--sc-accent)_10%,transparent)] text-[var(--sc-ink-soft)]'
  return 'bg-transparent text-[var(--color-pib-text-muted)]/50'
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
    <div className="space-y-6 p-4 md:p-6" data-module-accent="violet">
      <AnalyticsNav active="retention" propertyId={propertyId} />
      <PageHeader
        eyebrow="Analytics · Retention"
        title="Retention."
      />

      <div className="st-panel space-y-4">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 items-end">
        <div>
          <label className="pib-label mb-1">Cohort Event</label>
          <input name="page-field-29" className="pib-input w-full" value={cohortEvent} onChange={e => setCohortEvent(e.target.value)} />
        </div>
        <div>
          <label className="pib-label mb-1">Return Event</label>
          <input name="page-field-30" className="pib-input w-full" value={returnEvent} onChange={e => setReturnEvent(e.target.value)} />
        </div>
        <div>
          <label className="pib-label mb-1">From</label>
          <input name="date" className="pib-input w-full" type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="pib-label mb-1">To</label>
          <input name="date" className="pib-input w-full" type="date" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div>
          <label className="pib-label mb-1">Granularity</label>
          <select name="page-select-31" className="pib-select w-full" value={granularity} onChange={e => setGranularity(e.target.value as 'day' | 'week')}>
            <option value="day">Day</option>
            <option value="week">Week</option>
          </select>
        </div>
        <div className="md:col-span-3">
          <button name="page-action-32" className="st-btn st-btn--primary w-full" onClick={load} disabled={!propertyId || loading}>
            {loading ? 'Computing…' : 'Compute Retention'}
          </button>
        </div>
        </div>
      </div>

      {error && <p className="text-[var(--color-error)] text-sm">{error}</p>}

      {result && result.rows.length === 0 && (
        <EmptyState title="No cohort data found for this range." />
      )}

      {result && result.rows.length > 0 && (
        <div className="st-panel overflow-x-auto">
          <table className="text-xs w-full border-collapse">
            <thead>
              <tr className="text-[var(--color-pib-text-muted)]">
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
                <tr key={row.cohortLabel} className="border-t border-[var(--color-pib-line)]">
                  <td className="p-2 pr-4 font-mono whitespace-nowrap text-[var(--color-pib-text)]">{row.cohortLabel}</td>
                  <td className="p-2 text-right text-[var(--color-pib-text-muted)]">{row.cohortSize.toLocaleString()}</td>
                  {row.periods.map((pct, i) => (
                    <td key={i} className={`p-2 text-center rounded-sm m-0.5 ${heatColor(pct)}`}>
                      {pct !== null ? `${pct}%` : ' - '}
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
