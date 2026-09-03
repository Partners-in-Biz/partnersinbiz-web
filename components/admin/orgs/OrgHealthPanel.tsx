'use client'

import { useEffect, useState } from 'react'
import { Surface, StatusPill, EmptyState } from '@/components/ui/AppFoundation'
import { TrendAreaChart } from '@/components/ui/Charts'
import { apiGet } from './OrgDetailApi'

import { Icon } from '@/components/studio'

interface HealthPillar {
  key: string
  label: string
  score: number
  max: number
  factors: string[]
}

interface HealthResponse {
  score: number
  band: 'healthy' | 'watch' | 'at_risk'
  pillars: HealthPillar[]
  alerts: Array<{ kind: 'at_risk' | 'upsell'; message: string }>
  history: Array<{ date: string; score: number; band: string }>
}

const BAND_TONE: Record<string, 'success' | 'warn' | 'danger'> = {
  healthy: 'success',
  watch: 'warn',
  at_risk: 'danger',
}

const BAND_COLOR: Record<string, string> = {
  healthy: '#4ade80',
  watch: '#F59E0B',
  at_risk: '#ef4444',
}

export function OrgHealthPanel({ slug }: { slug: string }) {
  const [data, setData] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGet<HealthResponse>(`/api/v1/admin/org/${slug}/health`)
      .then((d) => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [slug])

  if (loading) return <Surface className="text-[var(--color-pib-text-muted)] text-sm">Computing health score…</Surface>
  if (error) return <Surface className="text-[var(--st-danger)] text-sm">{error}</Surface>
  if (!data) return null

  const ringColor = BAND_COLOR[data.band] ?? '#F59E0B'
  const circumference = 2 * Math.PI * 52
  const dash = (data.score / 100) * circumference

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
        {/* Score gauge */}
        <Surface className="flex flex-col items-center justify-center gap-3 min-w-[220px]">
          <div className="relative h-[140px] w-[140px]">
            <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
              <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
              <circle
                cx="60" cy="60" r="52" fill="none" stroke={ringColor} strokeWidth="10"
                strokeLinecap="round" strokeDasharray={`${dash} ${circumference}`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-headline font-medium text-[var(--color-pib-text)]">{data.score}</span>
              <span className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">/ 100</span>
            </div>
          </div>
          <StatusPill tone={BAND_TONE[data.band] ?? 'neutral'} dot>
            {data.band.replace('_', ' ')}
          </StatusPill>
        </Surface>

        {/* Pillars */}
        <Surface header={<span className="font-label">Pillar breakdown</span>}>
          <div className="space-y-4">
            {data.pillars.map((p) => (
              <div key={p.key}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-[var(--color-pib-text)]">{p.label}</span>
                  <span className="text-[var(--color-pib-text-muted)]">{p.score} / {p.max}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-md bg-white/5">
                  <div
                    className="h-full rounded-md"
                    style={{ width: `${(p.score / p.max) * 100}%`, background: 'var(--color-pib-accent)' }}
                  />
                </div>
                <ul className="mt-1.5 space-y-0.5">
                  {p.factors.map((f, i) => (
                    <li key={i} className="text-[11px] text-[var(--color-pib-text-muted)]">• {f}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Surface>
      </div>

      {/* Alerts */}
      {data.alerts.length > 0 && (
        <Surface header={<span className="font-label">Alerts</span>}>
          <div className="space-y-2">
            {data.alerts.map((a, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <Icon name={a.kind === 'upsell' ? 'trending_up' : 'warning'} className="text-[18px]" style={{ color: a.kind === 'upsell' ? '#4ade80' : '#ef4444' }} />
                <span className="text-[var(--color-pib-text)]">{a.message}</span>
              </div>
            ))}
          </div>
        </Surface>
      )}

      {/* History */}
      <Surface header={<span className="font-label">Health history (last 30 snapshots)</span>}>
        {data.history.length > 1 ? (
          <TrendAreaChart
            data={data.history.map((h) => ({ label: h.date.slice(5), value: h.score }))}
            height={200}
          />
        ) : (
          <EmptyState
            icon="show_chart"
            title="Building history"
            description="A daily snapshot is recorded each time this page loads. The trend appears once there are at least two days of data."
          />
        )}
      </Surface>
    </div>
  )
}
