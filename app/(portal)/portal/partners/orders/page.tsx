'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface PartnerOrder {
  id: string
  tradeOrderId: string
  direction: 'purchase' | 'sales'
  partnerOrderStatus: 'pending' | 'confirmed' | 'rejected' | 'cancelled'
  title?: string
  total: number
  currency: string
  notes?: string
  invoiceId?: string
  lineItems?: Array<{ name: string; qty: number; unitPrice: number; total: number }>
  createdAt?: { seconds?: number; _seconds?: number }
}

function unwrap(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  return (b.data as Record<string, unknown>) ?? b
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-ZA', { style: 'currency', currency }).format(value)
  } catch {
    return `${currency} ${(value ?? 0).toFixed(2)}`
  }
}

const STATUS_CLS: Record<PartnerOrder['partnerOrderStatus'], string> = {
  pending: 'pib-pill-warn',
  confirmed: 'pib-pill-success',
  rejected: 'pib-pill-danger',
  cancelled: '',
}

export default function PartnerOrdersPage() {
  const [orders, setOrders] = useState<PartnerOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/crm/partner-orders')
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) {
        setError((data?.error as string) || 'Could not load orders.')
        return
      }
      setOrders((data?.orders as PartnerOrder[]) ?? [])
    } catch {
      setError('Could not load orders.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function decide(order: PartnerOrder, decision: 'confirm' | 'reject') {
    if (decision === 'confirm' && !window.confirm(
      'Confirm this order?\n\nStock will be reserved and a draft invoice created in your workspace.',
    )) return
    setBusyId(order.id)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/crm/partner-orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) {
        setError((data?.error as string) || `Could not ${decision} the order.`)
        return
      }
      setNotice(decision === 'confirm'
        ? `Order confirmed. Stock reserved${data?.invoiceNumber ? ` and invoice ${data.invoiceNumber} drafted` : ''}.`
        : 'Order declined.')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const incoming = orders.filter((o) => o.direction === 'sales')
  const outgoing = orders.filter((o) => o.direction === 'purchase')

  function renderOrder(order: PartnerOrder, canDecide: boolean) {
    return (
      <li key={order.id} className="rounded-lg border border-[var(--color-pib-line)] bg-black/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-pib-text)]">
            {order.title || 'Partner order'}
          </span>
          <span className={`pib-pill px-2 py-0.5 text-[10px] ${STATUS_CLS[order.partnerOrderStatus]}`}>
            {order.partnerOrderStatus}
          </span>
          <span className="font-mono text-sm text-[var(--color-pib-text)]">
            {money(order.total, order.currency)}
          </span>
        </div>

        {order.lineItems && order.lineItems.length > 0 ? (
          <ul className="mt-2 space-y-0.5">
            {order.lineItems.map((l, i) => (
              <li key={i} className="flex justify-between gap-3 text-[11px] text-[var(--color-pib-text-muted)]">
                <span className="min-w-0 truncate">{l.name} × {l.qty}</span>
                <span className="font-mono">{money(l.total, order.currency)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {order.notes ? (
          <p className="mt-2 rounded border-l-2 border-[var(--color-accent-v2)] bg-white/[0.03] px-2 py-1 text-[11px] text-[var(--color-pib-text-muted)]">
            {order.notes}
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {canDecide && order.partnerOrderStatus === 'pending' ? (
            <>
              <button
                type="button"
                onClick={() => void decide(order, 'confirm')}
                disabled={busyId === order.id}
                className="rounded-md bg-[var(--color-accent-v2)] px-3 py-1 text-xs font-semibold text-black disabled:opacity-50"
              >
                {busyId === order.id ? 'Working…' : 'Confirm'}
              </button>
              <button
                type="button"
                onClick={() => void decide(order, 'reject')}
                disabled={busyId === order.id}
                className="rounded-md border border-[var(--color-pib-line)] px-3 py-1 text-xs text-[var(--color-pib-text-muted)] transition hover:text-rose-300 disabled:opacity-50"
              >
                Decline
              </button>
            </>
          ) : null}
          {order.invoiceId ? (
            <Link
              href={`/portal/invoicing/${order.invoiceId}`}
              className="text-[11px] text-[var(--color-pib-text-muted)] hover:text-[var(--color-accent-v2)]"
            >
              View invoice →
            </Link>
          ) : null}
        </div>
      </li>
    )
  }

  return (
    <div className="space-y-5 p-4">
      <div>
        <Link href="/portal/partners" className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">
          ← Back to partners
        </Link>
        <p className="eyebrow mt-2">CRM</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-[var(--color-pib-text)]">Partner orders</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
          Orders placed across your workspace links. Confirming an incoming order reserves your stock and drafts an
          invoice; nothing moves while it is pending.
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>
      ) : null}
      {notice ? (
        <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{notice}</p>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--color-pib-text-muted)]">Loading…</p>
      ) : (
        <>
          <section className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-pib-text)]">
              Orders you received {incoming.length > 0 ? `(${incoming.length})` : ''}
            </h2>
            {incoming.length === 0 ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]">No partner has ordered from you yet.</p>
            ) : (
              <ul className="space-y-2">{incoming.map((o) => renderOrder(o, true))}</ul>
            )}
          </section>

          <section className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-pib-text)]">
              Orders you placed {outgoing.length > 0 ? `(${outgoing.length})` : ''}
            </h2>
            {outgoing.length === 0 ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]">
                You haven&rsquo;t ordered from a partner yet. Open a linked partner to browse their catalogue.
              </p>
            ) : (
              <ul className="space-y-2">{outgoing.map((o) => renderOrder(o, false))}</ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
