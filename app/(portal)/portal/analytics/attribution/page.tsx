'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { DateRangePicker, defaultRange, type DateRangeValue } from '@/components/analytics/DateRangePicker'
import { KpiCard, SimpleTable } from '@/components/analytics/Primitives'

type AttributionModel = 'last' | 'first' | 'linear' | 'time_decay'

const MODELS: Array<{ key: AttributionModel; label: string }> = [
  { key: 'last', label: 'Last touch' },
  { key: 'first', label: 'First touch' },
  { key: 'linear', label: 'Linear' },
  { key: 'time_decay', label: 'Time decay' },
]

interface Goal {
  id: string
  name: string
}

interface AttributionData {
  model: string
  goal: string
  totalConversions: number
  channels: Array<{ channel: string; source: string; medium: string; conversions: number; value: number }>
  topPaths: Array<{ path: string; count: number; value: number }>
}

interface JourneyData {
  distinctId: string
  userId: string | null
  sessions: Array<{ sessionId: string; startedAt: string; source: string; medium: string; campaign: string; landingUrl: string }>
}

export default function AttributionPage() {
  const sp = useSearchParams()
  const [propertyId, setPropertyId] = useState(sp?.get('propertyId') ?? '')
  const [range, setRange] = useState<DateRangeValue>(defaultRange(30))
  const [model, setModel] = useState<AttributionModel>('last')
  const [goals, setGoals] = useState<Goal[]>([])
  const [goalId, setGoalId] = useState('')
  const [data, setData] = useState<AttributionData | null>(null)
  const [loading, setLoading] = useState(false)

  const [distinctId, setDistinctId] = useState('')
  const [journey, setJourney] = useState<JourneyData | null>(null)
  const [journeyLoading, setJourneyLoading] = useState(false)

  const loadGoals = useCallback(async () => {
    if (!propertyId) { setGoals([]); return }
    try {
      const res = await fetch(`/api/v1/analytics/conversions?propertyId=${encodeURIComponent(propertyId)}`)
      const body = await res.json()
      setGoals(res.ok ? (body.data ?? body) : [])
    } catch { setGoals([]) }
  }, [propertyId])

  useEffect(() => { loadGoals() }, [loadGoals])

  const load = useCallback(async () => {
    if (!propertyId) { setData(null); return }
    setLoading(true)
    try {
      const qs = new URLSearchParams({ propertyId, from: range.from, to: range.to, model })
      if (goalId) qs.set('goalId', goalId)
      const res = await fetch(`/api/v1/analytics/attribution?${qs}`)
      const body = await res.json()
      setData(res.ok ? (body.data ?? body) : null)
    } catch { setData(null) } finally { setLoading(false) }
  }, [propertyId, range, model, goalId])

  useEffect(() => { load() }, [load])

  async function loadJourney() {
    if (!propertyId || !distinctId.trim()) return
    setJourneyLoading(true)
    try {
      const qs = new URLSearchParams({ propertyId, from: range.from, to: range.to, distinctId: distinctId.trim() })
      const res = await fetch(`/api/v1/analytics/attribution?${qs}`)
      const body = await res.json()
      setJourney(res.ok ? (body.data ?? body) : null)
    } catch { setJourney(null) } finally { setJourneyLoading(false) }
  }

  function csvHref(): string {
    const qs = new URLSearchParams({ propertyId, from: range.from, to: range.to, model, format: 'csv' })
    if (goalId) qs.set('goalId', goalId)
    return `/api/v1/analytics/attribution?${qs}`
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <AnalyticsNav active="attribution" propertyId={propertyId} />
      <h1 className="text-xl font-headline font-bold text-on-surface">Attribution</h1>

      <div className="pib-card p-4 space-y-3">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        {propertyId && (
          <>
            <div>
              <label className="text-xs text-on-surface-variant font-label block mb-1">Goal (optional)</label>
              <select value={goalId} onChange={e => setGoalId(e.target.value)} className="pib-input text-sm w-72">
                <option value="">Default conversion ($identify)</option>
                {goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-on-surface-variant font-label block mb-1">Attribution model</label>
              <div className="flex gap-2 flex-wrap">
                {MODELS.map(m => (
                  <button
                    key={m.key}
                    onClick={() => setModel(m.key)}
                    className={`text-xs px-3 py-1.5 rounded font-label transition-colors ${
                      model === m.key ? 'bg-amber-400/20 text-amber-400' : 'pib-btn-secondary'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <DateRangePicker value={range} onChange={setRange} />
            <div className="flex justify-end">
              <a href={csvHref()} download className="pib-btn-secondary text-xs px-3 py-1.5">
                Export CSV
              </a>
            </div>
          </>
        )}
      </div>

      {!propertyId && (
        <div className="pib-card p-8 text-center text-on-surface-variant text-sm">
          Select a client and property to see attribution.
        </div>
      )}

      {propertyId && loading && <div className="pib-skeleton h-24 rounded-lg" />}

      {propertyId && !loading && data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Total Conversions" value={data.totalConversions.toLocaleString()} accent sub={`${data.model} model`} />
          </div>

          <div>
            <h2 className="text-sm font-label font-semibold text-on-surface mb-2">Per-touchpoint credit</h2>
            <SimpleTable
              columns={[
                { key: 'channel', label: 'Channel' },
                { key: 'source', label: 'Source' },
                { key: 'medium', label: 'Medium' },
                { key: 'conversions', label: 'Conversions', align: 'right' },
                { key: 'value', label: 'Value (R)', align: 'right' },
              ]}
              rows={data.channels}
              empty="No attributed conversions in this range."
            />
          </div>

          <div>
            <h2 className="text-sm font-label font-semibold text-on-surface mb-2">Top conversion paths</h2>
            <SimpleTable
              columns={[
                { key: 'path', label: 'Path' },
                { key: 'count', label: 'Count', align: 'right' },
                { key: 'value', label: 'Value (R)', align: 'right' },
              ]}
              rows={data.topPaths}
              empty="No conversion paths in this range."
            />
          </div>
        </>
      )}

      {/* Contact journey viewer */}
      {propertyId && (
        <div className="pib-card p-4 space-y-3">
          <h2 className="text-sm font-label font-semibold text-on-surface">Contact journey</h2>
          <div className="flex gap-2 items-end">
            <div>
              <label className="text-xs text-on-surface-variant font-label block mb-1">Distinct ID</label>
              <input
                type="text"
                value={distinctId}
                onChange={e => setDistinctId(e.target.value)}
                placeholder="distinct id"
                className="pib-input text-sm w-72"
              />
            </div>
            <button onClick={loadJourney} disabled={!distinctId.trim() || journeyLoading} className="pib-btn-primary text-sm font-label">
              {journeyLoading ? 'Loading…' : 'View Journey'}
            </button>
          </div>
          {journey && (
            <div className="space-y-2">
              <p className="text-xs text-on-surface-variant">
                {journey.distinctId}{journey.userId ? ` · user: ${journey.userId}` : ''}
              </p>
              <SimpleTable
                columns={[
                  { key: 'startedAt', label: 'Started' },
                  { key: 'source', label: 'Source' },
                  { key: 'medium', label: 'Medium' },
                  { key: 'campaign', label: 'Campaign' },
                  { key: 'landingUrl', label: 'Landing URL' },
                ]}
                rows={journey.sessions}
                empty="No sessions for this contact."
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
