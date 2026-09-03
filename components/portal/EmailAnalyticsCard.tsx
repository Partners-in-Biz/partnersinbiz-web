'use client'

// components/portal/EmailAnalyticsCard.tsx
//
// Compact KPI tile drop-in for /portal/dashboard. The API derives the orgId
// from the client's session so we don't need to thread it through props.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { OrgEmailOverview } from '@/lib/email-analytics/aggregate'

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

export function EmailAnalyticsCard({ orgId }: { orgId?: string }) {
  const [data, setData] = useState<OrgEmailOverview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const now = new Date()
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const to = now.toISOString()
    // For client role, omit orgId  -  server uses the user's bound org. Admins
    // pass it explicitly.
    const orgParam = orgId ? `orgId=${orgId}&` : ''
    fetch(`/api/v1/email-analytics/overview?${orgParam}from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((b) => setData(b.data ?? null))
      .finally(() => setLoading(false))
  }, [orgId])

  if (loading) {
    return <div className="h-32 rounded-md bg-[var(--color-pib-surface-soft)] animate-pulse" />
  }

  if (!data) {
    return (
      <div className="rounded-md bg-[var(--color-pib-surface-soft)] p-4">
        <h3 className="text-sm font-medium text-[var(--color-pib-text)] mb-1">Email analytics</h3>
        <p className="text-[var(--color-pib-text-muted)] text-xs">No email activity yet.</p>
      </div>
    )
  }

  const { totals, rates } = data
  const tiles = [
    { label: 'Sent', value: totals.sent.toLocaleString() },
    { label: 'Open rate', value: pct(rates.openRate) },
    { label: 'Click rate', value: pct(rates.clickRate) },
    { label: 'Bounce rate', value: pct(rates.bounceRate) },
  ]

  return (
    <div className="rounded-md bg-[var(--color-pib-surface-soft)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-[var(--color-pib-text)]">Email (last 30 days)</h3>
        <Link href="/portal/email-analytics" className="text-xs text-[var(--st-warning)] hover:underline">
          View full report →
        </Link>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="bg-[var(--color-pib-surface)] rounded-lg p-2">
            <div className="pib-label">{t.label}</div>
            <div className="text-base font-medium text-[var(--color-pib-text)]">{t.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
