'use client'

import { useEffect, useState } from 'react'
import { Surface, StatusPill, EmptyState } from '@/components/ui/AppFoundation'
import { apiGet, formatZar, formatDate } from './OrgDetailApi'

interface Invoice {
  id: string
  number: string
  status: string
  total: number
  currency: string
  issuedAt: string | null
  dueAt: string | null
  paidAt: string | null
}

interface BillingResponse {
  billing: {
    recurringAmount?: number
    cadence?: string
    currency?: string
    state?: string
    trialEndsAt?: string | null
    paymentMethod?: string
  } | null
  mrrZar: number
  monthlyRecurring: number
  invoices: Invoice[]
}

const STATE_TONE: Record<string, 'success' | 'warn' | 'danger' | 'neutral'> = {
  active: 'success', trial: 'accent' as 'success', past_due: 'danger', paused: 'warn', cancelled: 'neutral',
}

const INVOICE_TONE: Record<string, 'success' | 'warn' | 'danger' | 'neutral'> = {
  paid: 'success', partially_paid: 'warn', overdue: 'danger', past_due: 'danger', sent: 'neutral', draft: 'neutral',
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-on-surface-variant">{label}</span>
      <span className="font-medium text-on-surface">{value}</span>
    </div>
  )
}

export function OrgBillingPanel({ slug }: { slug: string }) {
  const [data, setData] = useState<BillingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGet<BillingResponse>(`/api/v1/admin/org/${slug}/billing`)
      .then((d) => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [slug])

  if (loading) return <Surface className="text-on-surface-variant text-sm">Loading billing…</Surface>
  if (error) return <Surface className="text-red-400 text-sm">{error}</Surface>
  if (!data) return null

  const b = data.billing

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Surface header={<span className="font-label">Recurring billing (EFT / manual)</span>}>
          {b ? (
            <div className="divide-y divide-white/5">
              <Row label="Recurring amount" value={typeof b.recurringAmount === 'number' ? `${b.currency ?? 'ZAR'} ${b.recurringAmount.toLocaleString()}` : '—'} />
              <Row label="Cadence" value={b.cadence ?? 'monthly'} />
              <Row label="State" value={<StatusPill tone={STATE_TONE[b.state ?? ''] ?? 'neutral'} dot>{b.state ?? 'unknown'}</StatusPill>} />
              <Row label="MRR (ZAR)" value={formatZar(data.mrrZar)} />
              <Row label="Payment method" value={b.paymentMethod ?? '—'} />
              <Row label="Trial ends" value={b.trialEndsAt ? formatDate(b.trialEndsAt) : '—'} />
            </div>
          ) : (
            <EmptyState icon="payments" title="No billing configured" description="This org has no adminBilling block set." />
          )}
        </Surface>

        <Surface header={<span className="font-label">Recent invoices</span>}>
          {data.invoices.length === 0 ? (
            <EmptyState icon="receipt_long" title="No invoices" description="No invoices found for this organisation." />
          ) : (
            <div className="divide-y divide-white/5">
              {data.invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-on-surface">{inv.number}</p>
                    <p className="text-xs text-on-surface-variant">{formatDate(inv.issuedAt)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-on-surface">{inv.currency} {inv.total.toLocaleString()}</span>
                    <StatusPill tone={INVOICE_TONE[inv.status] ?? 'neutral'}>{inv.status}</StatusPill>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Surface>
      </div>
    </div>
  )
}
