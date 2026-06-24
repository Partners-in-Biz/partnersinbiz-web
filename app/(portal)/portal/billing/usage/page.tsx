'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

type MeterStatus = 'ok' | 'warning' | 'critical' | 'over'

type Meter = {
  key: string
  label: string
  unit: string
  used: number
  limit: number
  unlimited: boolean
  percent: number
  status: MeterStatus
  resetsMonthly: boolean
  helper: string
}

type UsageResponse = {
  orgName: string
  planKey: string
  planName: string
  month: string
  meters: Meter[]
  thresholds: { warning: number; critical: number }
  overagePolicy: string
  summary: { anyWarning: boolean; anyOver: boolean; alertsFired: string[] }
}

const METER_ICON: Record<string, string> = {
  emailSends: 'outgoing_mail',
  contacts: 'group',
  socialPosts: 'share',
  apiCalls: 'api',
  storage: 'database',
}

const STATUS_STYLE: Record<MeterStatus, { bar: string; pill: string; label: string }> = {
  ok: { bar: 'bg-[var(--color-pib-accent)]', pill: 'pib-pill', label: 'Healthy' },
  warning: { bar: 'bg-amber-400', pill: 'pib-pill', label: 'Approaching limit' },
  critical: { bar: 'bg-orange-500', pill: 'pib-pill', label: 'Almost exhausted' },
  over: { bar: 'bg-red-500', pill: 'pib-pill', label: 'Over limit' },
}

function formatUsed(meter: Meter): string {
  if (meter.unit === 'MB' && meter.used >= 1024) {
    return `${(meter.used / 1024).toFixed(2)} GB`
  }
  return `${meter.used.toLocaleString()} ${meter.unit}`
}

function formatLimit(meter: Meter): string {
  if (meter.unlimited) return 'Unlimited'
  if (meter.unit === 'MB' && meter.limit >= 1024) {
    return `${(meter.limit / 1024).toFixed(0)} GB`
  }
  return `${meter.limit.toLocaleString()} ${meter.unit}`
}

function MeterCard({ meter, thresholds }: { meter: Meter; thresholds: { warning: number; critical: number } }) {
  const style = STATUS_STYLE[meter.status]
  const fillPercent = meter.unlimited ? 0 : Math.min(100, meter.percent)
  return (
    <div className="pib-card space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-[24px] text-[var(--color-pib-accent)]" aria-hidden="true">
            {METER_ICON[meter.key] ?? 'monitoring'}
          </span>
          <div>
            <p className="text-sm font-semibold text-[var(--color-pib-text)]">{meter.label}</p>
            <p className="text-xs text-[var(--color-pib-text-muted)]">{meter.helper}</p>
          </div>
        </div>
        {!meter.unlimited && (
          <span className={`${style.pill} shrink-0 text-[11px]`}>{meter.percent}%</span>
        )}
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <p className="text-xl font-semibold text-[var(--color-pib-text)]">{formatUsed(meter)}</p>
          <p className="text-xs text-[var(--color-pib-text-muted)]">of {formatLimit(meter)}</p>
        </div>
        <div
          className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-pib-surface-soft)]"
          role="progressbar"
          aria-valuenow={meter.unlimited ? undefined : meter.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${meter.label} usage`}
        >
          {!meter.unlimited && (
            <div className={`relative h-full rounded-full transition-all ${style.bar}`} style={{ width: `${fillPercent}%` }} />
          )}
        </div>
        {!meter.unlimited && (
          <div className="relative mt-1 h-3 w-full text-[10px] text-[var(--color-pib-text-muted)]">
            <span className="absolute -translate-x-1/2" style={{ left: `${thresholds.warning}%` }}>
              {thresholds.warning}%
            </span>
            <span className="absolute -translate-x-1/2" style={{ left: `${thresholds.critical}%` }}>
              {thresholds.critical}%
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className={`${style.pill} text-[11px]`}>{style.label}</span>
        <span className="text-[11px] text-[var(--color-pib-text-muted)]">
          {meter.resetsMonthly ? 'Resets monthly' : 'Lifetime total'}
        </span>
      </div>
    </div>
  )
}

export default function PortalUsagePage() {
  const searchParams = useSearchParams()
  const endpoint = scopedApiPath('/api/v1/billing/usage', scopeFromSearchParams(searchParams))
  const [data, setData] = useState<UsageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    fetch(endpoint)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error ?? 'Failed to load usage')
        return (body.data ?? body) as UsageResponse
      })
      .then((body) => {
        if (alive) setData(body)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load usage')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [endpoint])

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="h-6 w-48 rounded bg-[var(--color-pib-surface-soft)]" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="pib-card h-44 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl">
        <div className="pib-card p-6">
          <p className="text-sm text-red-400">{error || 'No usage data available.'}</p>
          <Link href="/portal/billing" className="pib-btn-ghost mt-4">Back to billing</Link>
        </div>
      </div>
    )
  }

  const monthLabel = (() => {
    const [y, m] = data.month.split('-').map(Number)
    if (!y || !m) return data.month
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  })()

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="pib-card p-6">
        <p className="eyebrow">Billing</p>
        <h1 className="pib-page-title mt-2">Usage &amp; limits</h1>
        <p className="mt-3 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
          Live usage for {data.orgName} against the {data.planName} plan. Monthly meters reset on the 1st (UTC).
          You will get an email alert at 80% and 95% of any limit.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="pib-pill">{data.planName} plan</span>
          <span className="pib-pill">{monthLabel}</span>
          <Link href="/portal/billing" className="pib-btn-ghost">Back to billing</Link>
        </div>
      </header>

      {data.summary.anyOver && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          <span className="material-symbols-outlined mr-2 align-middle text-[18px]">warning</span>
          One or more limits have been exceeded. Overage is reconciled on your next EFT invoice — nothing is auto-charged.
        </div>
      )}
      {!data.summary.anyOver && data.summary.anyWarning && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          <span className="material-symbols-outlined mr-2 align-middle text-[18px]">info</span>
          You are approaching one or more plan limits. Consider upgrading before they reset.
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.meters.map((meter) => (
          <MeterCard key={meter.key} meter={meter} thresholds={data.thresholds} />
        ))}
      </section>

      <section className="pib-card p-5">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Overage policy</p>
        <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{data.overagePolicy}</p>
      </section>
    </div>
  )
}
