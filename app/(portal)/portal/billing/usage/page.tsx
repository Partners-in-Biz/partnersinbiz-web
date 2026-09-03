'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { PageHeader } from '@/components/ui/AppFoundation'
import { ButtonLink, Icon, Notice, Panel, Skeleton, Status } from '@/components/studio'
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

const STATUS_META: Record<MeterStatus, { tone?: 'success' | 'warning' | 'danger' | 'info'; label: string }> = {
  ok: { tone: 'success', label: 'Healthy' },
  warning: { tone: 'warning', label: 'Approaching limit' },
  critical: { tone: 'warning', label: 'Almost exhausted' },
  over: { tone: 'danger', label: 'Over limit' },
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

function barTone(status: MeterStatus): string {
  switch (status) {
    case 'ok':
      return 'var(--st-success)'
    case 'warning':
      return 'var(--st-warning)'
    case 'critical':
      return 'var(--st-warning)'
    case 'over':
      return 'var(--st-danger)'
    default:
      return 'var(--sc-ink)'
  }
}

function MeterCard({ meter, thresholds }: { meter: Meter; thresholds: { warning: number; critical: number } }) {
  const meta = STATUS_META[meter.status]
  const fillPercent = meter.unlimited ? 0 : Math.min(100, meter.percent)
  return (
    <Panel className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Icon name={METER_ICON[meter.key] ?? 'monitoring'} className="text-[var(--sc-ink-soft)]" />
          <div>
            <p className="sc-body text-[var(--sc-ink)]">{meter.label}</p>
            <p className="sc-body text-[0.875rem] text-[var(--sc-ink-soft)]">{meter.helper}</p>
          </div>
        </div>
        {!meter.unlimited ? (
          <Status tone={meta.tone} className="shrink-0">{meter.percent}%</Status>
        ) : null}
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <p className="st-num text-[1.25rem] text-[var(--sc-ink)]">{formatUsed(meter)}</p>
          <p className="sc-tiny text-[var(--sc-ink-soft)]">of {formatLimit(meter)}</p>
        </div>
        <div
          className="mt-2 h-2.5 w-full overflow-hidden bg-[color-mix(in_srgb,var(--sc-ink)_6%,transparent)]"
          style={{ borderRadius: '4px' }}
          role="progressbar"
          aria-valuenow={meter.unlimited ? undefined : meter.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${meter.label} usage`}
        >
          {!meter.unlimited ? (
            <div
              className="relative h-full transition-all"
              style={{ width: `${fillPercent}%`, background: barTone(meter.status), borderRadius: '4px' }}
            />
          ) : null}
        </div>
        {!meter.unlimited ? (
          <div className="relative mt-1 h-3 w-full sc-tiny text-[var(--sc-ink-soft)]">
            <span className="absolute -translate-x-1/2" style={{ left: `${thresholds.warning}%` }}>
              {thresholds.warning}%
            </span>
            <span className="absolute -translate-x-1/2" style={{ left: `${thresholds.critical}%` }}>
              {thresholds.critical}%
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between">
        <Status tone={meta.tone}>{meta.label}</Status>
        <span className="sc-tiny text-[var(--sc-ink-soft)]">
          {meter.resetsMonthly ? 'Resets monthly' : 'Lifetime total'}
        </span>
      </div>
    </Panel>
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
        <Skeleton className="h-6 w-48" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader eyebrow="Billing" title="Usage and limits." description="Live plan usage for this workspace." />
        <Panel className="space-y-4">
          <Notice tone="danger">{error || 'No usage data available.'}</Notice>
          <ButtonLink href="/portal/billing" variant="ghost" size="sm">Back to billing</ButtonLink>
        </Panel>
      </div>
    )
  }

  const monthLabel = (() => {
    const [y, m] = data.month.split('-').map(Number)
    if (!y || !m) return data.month
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  })()

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <PageHeader
        eyebrow="Billing"
        title="Usage and limits."
        description={`Live usage for ${data.orgName} against the ${data.planName} plan. Monthly meters reset on the 1st (UTC). You will get an email alert at 80% and 95% of any limit.`}
        meta={(
          <>
            <Status>{data.planName} plan</Status>
            <Status>{monthLabel}</Status>
          </>
        )}
        actions={<ButtonLink href="/portal/billing" variant="ghost" size="sm">Back to billing</ButtonLink>}
      />

      {data.summary.anyOver ? (
        <Notice tone="danger">
          One or more limits have been exceeded. Overage is reconciled on your next EFT invoice. Nothing is auto-charged.
        </Notice>
      ) : null}
      {!data.summary.anyOver && data.summary.anyWarning ? (
        <Notice tone="warning">
          You are approaching one or more plan limits. Consider upgrading before they reset.
        </Notice>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.meters.map((meter) => (
          <MeterCard key={meter.key} meter={meter} thresholds={data.thresholds} />
        ))}
      </section>

      <Panel>
        <p className="sc-tiny">Overage policy</p>
        <p className="sc-body mt-2 text-[var(--sc-ink-soft)]">{data.overagePolicy}</p>
      </Panel>
    </div>
  )
}
