'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader } from '@/components/ui/AppFoundation'
import { StatCard } from '@/components/ui/StatCard'
import {
  Button,
  ButtonLink,
  Notice,
  Panel,
  Skeleton,
  Status,
  Title,
} from '@/components/studio'

interface PartnerInvoice {
  id: string
  invoiceNumber?: string
  status: string
  paymentState: 'unpaid' | 'pending_verification' | 'paid' | 'rejected'
  total: number
  currency: string
  partnerPayment?: {
    reference?: string
    amount?: number
    note?: string
    decisionNote?: string
  }
}

function unwrap(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  return (b.data as Record<string, unknown>) ?? b
}

function money(v: number, c: string): string {
  try { return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: c }).format(v) }
  catch { return `${c} ${(v ?? 0).toFixed(2)}` }
}

const STATE: Record<PartnerInvoice['paymentState'], { text: string; tone?: 'warning' | 'info' | 'success' | 'danger' }> = {
  unpaid: { text: 'Outstanding', tone: 'warning' },
  pending_verification: { text: 'Awaiting verification', tone: 'info' },
  paid: { text: 'Settled', tone: 'success' },
  rejected: { text: 'Payment rejected', tone: 'danger' },
}

export default function PartnerSettlementsPage() {
  const [receivable, setReceivable] = useState<PartnerInvoice[]>([])
  const [payable, setPayable] = useState<PartnerInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const idempotencyKeys = useRef(new Map<string, string>())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/crm/partner-settlements')
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) { setError((data?.error as string) || 'Could not load settlements.'); return }
      setReceivable((data?.receivable as PartnerInvoice[]) ?? [])
      setPayable((data?.payable as PartnerInvoice[]) ?? [])
    } catch {
      setError('Could not load settlements.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function post(invoice: PartnerInvoice, body: Record<string, unknown>, msg: string) {
    const action = typeof body.action === 'string' ? body.action : 'settlement'
    const keyId = `${invoice.id}:${action}`
    const idempotencyKey = idempotencyKeys.current.get(keyId) ?? crypto.randomUUID()
    idempotencyKeys.current.set(keyId, idempotencyKey)
    setBusyId(invoice.id); setError(null); setNotice(null)
    try {
      const res = await fetch(`/api/v1/crm/partner-settlements/${invoice.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(body),
      })
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) { setError((data?.error as string) || 'That action could not be completed.'); return }
      idempotencyKeys.current.delete(keyId)
      setNotice(msg)
      await load()
    } finally { setBusyId(null) }
  }

  async function pay(invoice: PartnerInvoice) {
    const reference = window.prompt(
      `Payment reference for ${invoice.invoiceNumber || 'this invoice'}\n\n${money(invoice.total, invoice.currency)}. Enter the EFT reference you used.`,
    )
    if (!reference?.trim()) return
    await post(invoice, { action: 'pay', reference: reference.trim(), amount: invoice.total },
      'Payment recorded. The supplier will verify it.')
  }

  async function reject(invoice: PartnerInvoice) {
    const note = window.prompt('Why can you not verify this payment? (shown to the payer)') ?? ''
    await post(invoice, { action: 'reject', note: note.trim() || undefined },
      'Payment rejected and the payer notified.')
  }

  function row(invoice: PartnerInvoice, side: 'receivable' | 'payable') {
    const state = STATE[invoice.paymentState]
    const p = invoice.partnerPayment
    return (
      <li key={invoice.id} className="st-panel st-panel--flat p-4">
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href={`/portal/invoicing/${invoice.id}`} variant="ghost" size="sm" className="min-w-0 flex-1 truncate !justify-start !px-0">
            {invoice.invoiceNumber || invoice.id}
          </ButtonLink>
          <Status tone={state.tone}>{state.text}</Status>
          <span className="st-num text-[var(--sc-ink)]">{money(invoice.total, invoice.currency)}</span>
        </div>

        {p?.reference ? (
          <p className="mt-2 sc-tiny text-[var(--sc-ink-soft)]">
            Ref {p.reference}{p.note ? ` · ${p.note}` : ''}
          </p>
        ) : null}
        {invoice.paymentState === 'rejected' && p?.decisionNote ? (
          <Notice tone="danger">{p.decisionNote}</Notice>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {side === 'payable' && (invoice.paymentState === 'unpaid' || invoice.paymentState === 'rejected') ? (
            <Button type="button" size="sm" onClick={() => void pay(invoice)} disabled={busyId === invoice.id} loading={busyId === invoice.id}>
              I have paid this
            </Button>
          ) : null}

          {side === 'receivable' && invoice.paymentState === 'pending_verification' ? (
            <>
              <Button type="button" size="sm"
                onClick={() => void post(invoice, { action: 'confirm' }, 'Payment confirmed. Invoice settled.')}
                disabled={busyId === invoice.id}
                loading={busyId === invoice.id}>
                Confirm receipt
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => void reject(invoice)} disabled={busyId === invoice.id}>
                Cannot verify
              </Button>
            </>
          ) : null}
        </div>
      </li>
    )
  }

  const owedToYou = receivable.filter((i) => i.paymentState !== 'paid')
    .reduce((s, i) => s + i.total, 0)
  const youOwe = payable.filter((i) => i.paymentState !== 'paid')
    .reduce((s, i) => s + i.total, 0)
  const currency = receivable[0]?.currency ?? payable[0]?.currency ?? 'ZAR'

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Partners"
        title="Partner settlements."
        description="Invoices raised from partner orders. Payment is EFT: the payer records the reference, and the org that issued the invoice confirms receipt. Only they can mark it settled."
        actions={<ButtonLink href="/portal/partners" variant="ghost" size="sm">Back to partners</ButtonLink>}
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {notice ? <Notice tone="info">{notice}</Notice> : null}

      {loading ? (
        <div className="space-y-4">
          <Skeleton height="5rem" />
          <Skeleton height="8rem" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Owed to you" value={money(owedToYou, currency)} />
            <StatCard label="You owe" value={money(youOwe, currency)} />
          </div>

          <Panel>
            <Title>
              Owed to you {receivable.length > 0 ? `(${receivable.length})` : ''}
            </Title>
            {receivable.length === 0 ? (
              <p className="mt-4 sc-body">No partner invoices raised yet.</p>
            ) : (
              <ul className="mt-4 space-y-4">{receivable.map((i) => row(i, 'receivable'))}</ul>
            )}
          </Panel>

          <Panel>
            <Title>
              You owe {payable.length > 0 ? `(${payable.length})` : ''}
            </Title>
            {payable.length === 0 ? (
              <p className="mt-4 sc-body">Nothing outstanding to partners.</p>
            ) : (
              <ul className="mt-4 space-y-4">{payable.map((i) => row(i, 'payable'))}</ul>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
