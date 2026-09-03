'use client'

import { useCallback, useEffect, useState } from 'react'
import { EmptyState, PageHeader } from '@/components/ui/AppFoundation'
import {
  Button,
  ButtonLink,
  Input,
  Notice,
  Panel,
  Skeleton,
  Status,
  Title,
} from '@/components/studio'

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
  fulfillmentStatus?: string
  lineItems?: Array<{ productId?: string; name: string; qty: number; unitPrice: number; total: number }>
  shippedQuantities?: Record<string, number>
  createdAt?: { seconds?: number; _seconds?: number }
}

interface ShipDraft {
  orderId: string
  quantities: Record<string, string>
  trackingNumber: string
  carrier: string
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

const STATUS_TONE: Record<PartnerOrder['partnerOrderStatus'], 'warning' | 'success' | 'danger' | 'info' | undefined> = {
  pending: 'warning',
  confirmed: 'success',
  rejected: 'danger',
  cancelled: undefined,
}

export default function PartnerOrdersPage() {
  const [orders, setOrders] = useState<PartnerOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [shipDraft, setShipDraft] = useState<ShipDraft | null>(null)

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

  async function act(order: PartnerOrder, body: Record<string, unknown>, successMsg: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusyId(order.id)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/crm/partner-orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) {
        setError((data?.error as string) || 'That action could not be completed.')
        return
      }
      setNotice(successMsg)
      await load()
    } finally {
      setBusyId(null)
    }
  }

  function outstandingOf(order: PartnerOrder, line: { productId?: string; qty: number }): number {
    if (!line.productId) return line.qty
    const shipped = order.shippedQuantities?.[line.productId] ?? 0
    return Math.max(0, line.qty - shipped)
  }

  function startShip(order: PartnerOrder) {
    const quantities: Record<string, string> = {}
    for (const line of order.lineItems ?? []) {
      if (line.productId) quantities[line.productId] = String(outstandingOf(order, line))
    }
    setShipDraft({ orderId: order.id, quantities, trackingNumber: '', carrier: '' })
  }

  async function submitShip(order: PartnerOrder, draft: ShipDraft) {
    const quantities: Record<string, number> = {}
    for (const line of order.lineItems ?? []) {
      if (!line.productId) continue
      const raw = Number(draft.quantities[line.productId])
      if (!Number.isFinite(raw) || raw <= 0) continue
      const capped = Math.min(raw, outstandingOf(order, line))
      if (capped > 0) quantities[line.productId] = capped
    }
    if (Object.keys(quantities).length === 0) {
      setError('Enter a quantity greater than zero for at least one product to ship.')
      return
    }
    const isPartial = (order.lineItems ?? []).some((line) => {
      if (!line.productId || !(line.productId in quantities)) return false
      return quantities[line.productId] < outstandingOf(order, line)
    })
    await act(
      order,
      {
        action: 'ship',
        quantities,
        trackingNumber: draft.trackingNumber || undefined,
        carrier: draft.carrier || undefined,
      },
      isPartial
        ? 'Partial shipment recorded. The order stays packed until everything outstanding has shipped.'
        : 'Marked as shipped. The reservation has been consumed and the buyer notified.',
    )
    setShipDraft(null)
  }

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
      <li key={order.id} className="st-panel st-panel--flat p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate sc-body text-[var(--sc-ink)]">
            {order.title || 'Partner order'}
          </span>
          <Status tone={STATUS_TONE[order.partnerOrderStatus]}>{order.partnerOrderStatus}</Status>
          <span className="st-num text-[var(--sc-ink)]">
            {money(order.total, order.currency)}
          </span>
        </div>

        {order.lineItems && order.lineItems.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {order.lineItems.map((l, i) => (
              <li key={i} className="flex justify-between gap-4 sc-body text-[0.75rem]">
                <span className="min-w-0 truncate">{l.name} × {l.qty}</span>
                <span className="st-num">{money(l.total, order.currency)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {order.notes ? (
          <p className="mt-2 border-l-2 border-[var(--sc-accent)] px-2 py-1 sc-body text-[0.75rem]">
            {order.notes}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {order.partnerOrderStatus === 'confirmed' && order.fulfillmentStatus ? (
            <Status>{order.fulfillmentStatus.replace('_', ' ')}</Status>
          ) : null}

          {canDecide && order.partnerOrderStatus === 'pending' ? (
            <>
              <Button
                type="button"
                size="sm"
                onClick={() => void decide(order, 'confirm')}
                disabled={busyId === order.id}
                loading={busyId === order.id}
              >
                Confirm
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void decide(order, 'reject')}
                disabled={busyId === order.id}
              >
                Decline
              </Button>
            </>
          ) : null}

          {canDecide && order.partnerOrderStatus === 'confirmed' ? (
            <>
              {['not_started', 'picking'].includes(order.fulfillmentStatus ?? '') ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void act(order, { action: 'pack' }, 'Marked as packed.')}
                  disabled={busyId === order.id}
                >
                  Mark packed
                </Button>
              ) : null}
              {['not_started', 'picking', 'packed'].includes(order.fulfillmentStatus ?? '') ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void startShip(order)}
                  disabled={busyId === order.id}
                >
                  Mark shipped
                </Button>
              ) : null}
              {order.fulfillmentStatus === 'in_transit' ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void act(order, { action: 'deliver' }, 'Marked as delivered.')}
                  disabled={busyId === order.id}
                  loading={busyId === order.id}
                >
                  Mark delivered
                </Button>
              ) : null}
            </>
          ) : null}

          {(order.partnerOrderStatus === 'pending' ||
            (canDecide && order.partnerOrderStatus === 'confirmed' &&
              ['not_started', 'picking', 'packed'].includes(order.fulfillmentStatus ?? ''))) ? (
            <Button
              type="button"
              size="sm"
              variant="danger"
              onClick={() => void act(
                order,
                { action: 'cancel' },
                'Order cancelled.',
                order.partnerOrderStatus === 'confirmed'
                  ? 'Cancel this confirmed order?\n\nReserved stock will be released back to available.'
                  : 'Cancel this order?',
              )}
              disabled={busyId === order.id}
            >
              Cancel
            </Button>
          ) : null}
          {order.invoiceId ? (
            <ButtonLink href={`/portal/invoicing/${order.invoiceId}`} variant="ghost" size="sm">
              View invoice
            </ButtonLink>
          ) : null}
        </div>

        {shipDraft?.orderId === order.id ? (
          <div className="mt-4 st-panel st-panel--flat p-4">
            <p className="mb-4 sc-body text-[0.75rem]">
              Ship a partial quantity per product. Leave a product at zero to ship it later.
            </p>
            <div className="space-y-4">
              {(order.lineItems ?? []).map((line, i) => (
                <label key={i} className="flex items-center justify-between gap-4 sc-body text-[0.75rem] text-[var(--sc-ink)]">
                  <span className="min-w-0 truncate">
                    {line.name} × {line.qty}
                    {line.productId && outstandingOf(order, line) < line.qty
                      ? <span className="text-[var(--sc-ink-soft)]"> ({outstandingOf(order, line)} remaining)</span>
                      : null}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    max={line.productId ? outstandingOf(order, line) : line.qty}
                    value={shipDraft.quantities[line.productId ?? ''] ?? '0'}
                    aria-label={`Ship quantity for ${line.name}`}
                    onChange={(e) => {
                      const productId = line.productId ?? ''
                      if (!productId) return
                      setShipDraft({ ...shipDraft, quantities: { ...shipDraft.quantities, [productId]: e.target.value } })
                    }}
                    className="w-20 text-right"
                  />
                </label>
              ))}
              <div className="grid grid-cols-2 gap-4">
                <Input
                  type="text"
                  placeholder="Tracking number (optional)"
                  aria-label="Tracking number"
                  value={shipDraft.trackingNumber}
                  onChange={(e) => setShipDraft({ ...shipDraft, trackingNumber: e.target.value })}
                />
                <Input
                  type="text"
                  placeholder="Carrier (optional)"
                  aria-label="Carrier"
                  value={shipDraft.carrier}
                  onChange={(e) => setShipDraft({ ...shipDraft, carrier: e.target.value })}
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => void submitShip(order, shipDraft)}
                disabled={busyId === order.id}
                loading={busyId === order.id}
              >
                Confirm shipment
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShipDraft(null)}
                disabled={busyId === order.id}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </li>
    )
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Partners"
        title="Partner orders."
        description="Orders placed across your workspace links. Confirming an incoming order reserves your stock and drafts an invoice; nothing moves while it is pending."
        actions={<ButtonLink href="/portal/partners" variant="ghost" size="sm">Back to partners</ButtonLink>}
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {notice ? <Notice tone="info">{notice}</Notice> : null}

      {loading ? (
        <div className="space-y-4">
          <Skeleton height="8rem" />
          <Skeleton height="8rem" />
        </div>
      ) : (
        <>
          <Panel>
            <Title>
              Orders you received {incoming.length > 0 ? `(${incoming.length})` : ''}
            </Title>
            {incoming.length === 0 ? (
              <p className="mt-4 sc-body">No partner has ordered from you yet.</p>
            ) : (
              <ul className="mt-4 space-y-4">{incoming.map((o) => renderOrder(o, true))}</ul>
            )}
          </Panel>

          <Panel>
            <Title>
              Orders you placed {outgoing.length > 0 ? `(${outgoing.length})` : ''}
            </Title>
            {outgoing.length === 0 ? (
              <EmptyState
                title="No orders placed yet."
                description="Open a linked partner to browse their catalogue."
              />
            ) : (
              <ul className="mt-4 space-y-4">{outgoing.map((o) => renderOrder(o, false))}</ul>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
