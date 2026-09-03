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

const AXIS_TICK = {
  className: 'sc-tiny',
  fill: 'var(--sc-ink-soft)',
  fontSize: 11,
} as const

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
          className="st-select"
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
          aria-label="Metric"
        >
          {METRICS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <span className="sc-tiny text-[var(--sc-ink-soft)]">Last {daysBack} days</span>
      </div>
      <div className="h-64 w-full">
        {loading ? (
          <div className="flex h-full items-center justify-center sc-body text-[var(--sc-ink-soft)]">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center sc-body text-[var(--sc-ink-soft)]">
            No data yet. Refresh insights or wait for the next cron pull.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows}>
              <CartesianGrid stroke="var(--sc-line)" strokeWidth={1} vertical={false} />
              <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{
                  background: 'var(--sc-surface)',
                  border: '1px solid var(--sc-line)',
                  borderRadius: 6,
                  color: 'var(--sc-ink)',
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--sc-accent)"
                strokeWidth={2}
                dot={{ r: 3, fill: 'var(--sc-accent)' }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
