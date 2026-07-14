'use client'
import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

interface Props {
  orgId: string
  level: 'campaign' | 'adset' | 'ad'
  pibEntityId: string
  /** Date range in days back from today. Default 7. */
  daysBack?: number
}

const METRICS: { value: string; label: string }[] = [
  { value: 'ad_spend', label: 'Spend' },
  { value: 'impressions', label: 'Impressions' },
  { value: 'clicks', label: 'Clicks' },
  { value: 'ctr', label: 'CTR' },
  { value: 'cpc', label: 'CPC' },
  { value: 'conversions', label: 'Conversions' },
  { value: 'roas', label: 'ROAS' },
]

interface MetricRow { date: string; value: number; metric: string }

export function InsightsChart({ orgId, level, pibEntityId, daysBack = 7 }: Props) {
  const [metric, setMetric] = useState('ad_spend')
  const [rows, setRows] = useState<MetricRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    const since = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10)
    const until = new Date().toISOString().slice(0, 10)
    const url = `/api/v1/ads/insights?level=${level}&dimensionId=${pibEntityId}&metric=${metric}&since=${since}&until=${until}`
    fetch(url, { headers: { 'X-Org-Id': orgId } })
      .then((r) => r.json())
      .then((body) => {
        if (body.success) {
          const sorted = (body.data as MetricRow[]).sort((a, b) => a.date.localeCompare(b.date))
          setRows(sorted)
        }
      })
      .finally(() => setLoading(false))
  }, [orgId, level, pibEntityId, metric, daysBack])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <select
          className="rounded border border-white/10 bg-white/5 px-2 py-1 text-sm"
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
          aria-label="Metric"
        >
          {METRICS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <span className="text-xs text-white/40">Last {daysBack} days</span>
      </div>
      <div className="h-64 w-full">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-white/40">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-white/40">
            No data yet — refresh insights or wait for the next cron pull.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="date" stroke="rgba(255,255,255,0.5)" tick={{ fontSize: 11 }} />
              <YAxis stroke="rgba(255,255,255,0.5)" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: '#0A0A0B', border: '1px solid rgba(255,255,255,0.1)' }} />
              <Line type="monotone" dataKey="value" stroke="var(--color-pib-rose)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
