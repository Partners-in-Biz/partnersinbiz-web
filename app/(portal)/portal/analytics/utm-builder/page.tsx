'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { DateRangePicker, defaultRange, type DateRangeValue } from '@/components/analytics/DateRangePicker'
import { SimpleTable, CopyButton } from '@/components/analytics/Primitives'

interface Campaign {
  source: string
  medium: string
  campaign: string
  sessions: number
  visitors: number
  bounceRate: number
  avgDurationSec: number
}

interface CampaignsData {
  campaigns: Campaign[]
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

const UTM_FIELDS: Array<{ key: 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_term' | 'utm_content'; label: string; placeholder: string }> = [
  { key: 'utm_source', label: 'Campaign Source', placeholder: 'google' },
  { key: 'utm_medium', label: 'Campaign Medium', placeholder: 'cpc' },
  { key: 'utm_campaign', label: 'Campaign Name', placeholder: 'spring_sale' },
  { key: 'utm_term', label: 'Campaign Term', placeholder: 'running+shoes' },
  { key: 'utm_content', label: 'Campaign Content', placeholder: 'logolink' },
]

function buildUrl(destination: string, params: Record<string, string>): string {
  if (!destination.trim()) return ''
  let base = destination.trim()
  let hash = ''
  const hashIdx = base.indexOf('#')
  if (hashIdx >= 0) {
    hash = base.slice(hashIdx)
    base = base.slice(0, hashIdx)
  }
  const qIdx = base.indexOf('?')
  const root = qIdx >= 0 ? base.slice(0, qIdx) : base
  const existing = qIdx >= 0 ? base.slice(qIdx + 1) : ''

  const parts: string[] = []
  if (existing) parts.push(existing)
  for (const [k, v] of Object.entries(params)) {
    if (v.trim()) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v.trim())}`)
  }
  const query = parts.join('&')
  return `${root}${query ? `?${query}` : ''}${hash}`
}

export default function UtmBuilderPage() {
  const sp = useSearchParams()
  const [propertyId, setPropertyId] = useState(sp?.get('propertyId') ?? '')
  const [range, setRange] = useState<DateRangeValue>(defaultRange(30))

  const [destination, setDestination] = useState('')
  const [utm, setUtm] = useState<Record<string, string>>({
    utm_source: '', utm_medium: '', utm_campaign: '', utm_term: '', utm_content: '',
  })

  const generated = useMemo(() => buildUrl(destination, utm), [destination, utm])

  const [data, setData] = useState<CampaignsData | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!propertyId) return
    setLoading(true)
    try {
      const qs = new URLSearchParams({ propertyId, from: range.from, to: range.to })
      const res = await fetch(`/api/v1/analytics/campaigns?${qs}`)
      const body = await res.json()
      setData(res.ok ? (body.data ?? body) : null)
    } catch { setData(null) } finally { setLoading(false) }
  }, [propertyId, range])

  useEffect(() => { load() }, [load])

  const rows = (data?.campaigns ?? []).map(c => ({
    source: c.source,
    medium: c.medium,
    campaign: c.campaign,
    sessions: c.sessions.toLocaleString(),
    visitors: c.visitors.toLocaleString(),
    bounceRate: `${c.bounceRate}%`,
    avgDuration: fmtDuration(c.avgDurationSec),
  }))

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <AnalyticsNav active="utm-builder" propertyId={propertyId} />
      <h1 className="text-xl font-headline font-bold text-on-surface">UTM Builder</h1>

      <div className="pib-card p-4 space-y-4">
        <h2 className="text-sm font-label font-semibold text-on-surface">Build a tagged URL</h2>
        <div>
          <label className="text-[10px] uppercase tracking-wide text-on-surface-variant font-label block">Destination URL</label>
          <input
            type="text"
            value={destination}
            onChange={e => setDestination(e.target.value)}
            placeholder="https://example.com/landing"
            className="pib-input text-sm w-full"
          />
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {UTM_FIELDS.map(f => (
            <div key={f.key}>
              <label className="text-[10px] uppercase tracking-wide text-on-surface-variant font-label block">{f.label}</label>
              <input
                type="text"
                value={utm[f.key]}
                onChange={e => setUtm(prev => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="pib-input text-sm w-full"
              />
            </div>
          ))}
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wide text-on-surface-variant font-label block mb-1">Generated URL</label>
          <div className="flex items-start gap-2">
            <textarea
              readOnly
              value={generated}
              placeholder="Enter a destination URL to generate a tagged link."
              rows={2}
              className="pib-input text-sm w-full font-mono break-all resize-none"
            />
            <CopyButton text={generated} label="Copy URL" />
          </div>
        </div>
      </div>

      <div className="pib-card p-4 space-y-3">
        <h2 className="text-sm font-label font-semibold text-on-surface">Campaign performance</h2>
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
        {propertyId && <DateRangePicker value={range} onChange={setRange} />}
      </div>

      {!propertyId && (
        <div className="pib-card p-8 text-center text-on-surface-variant text-sm">
          Select a client and property to see campaign performance.
        </div>
      )}

      {propertyId && loading && <div className="pib-skeleton h-24 rounded-lg" />}

      {propertyId && !loading && (
        <SimpleTable
          columns={[
            { key: 'source', label: 'Source' },
            { key: 'medium', label: 'Medium' },
            { key: 'campaign', label: 'Campaign' },
            { key: 'sessions', label: 'Sessions', align: 'right' },
            { key: 'visitors', label: 'Visitors', align: 'right' },
            { key: 'bounceRate', label: 'Bounce', align: 'right' },
            { key: 'avgDuration', label: 'Avg Session', align: 'right' },
          ]}
          rows={rows}
          empty="No campaign traffic in this range."
        />
      )}
    </div>
  )
}
