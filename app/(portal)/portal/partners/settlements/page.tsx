'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'

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

const STATE: Record<PartnerInvoice['paymentState'], { text: string; cls: string }> = {
  unpaid: { text: 'Outstanding', cls: 'pib-pill-warn' },
  pending_verification: { text: 'Awaiting verification', cls: 'pib-pill-info' },
  paid: { text: 'Settled', cls: 'pib-pill-success' },
  rejected: { text: 'Payment rejected', cls: 'pib-pill-danger' },
}

const CARD = 'rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)]'

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
      `Payment reference for ${invoice.invoiceNumber || 'this invoice'}\n\n${money(invoice.total, invoice.currency)} — enter the EFT reference you used.`,
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
      <li key={invoice.id} className="rounded-lg border border-[var(--color-pib-line)] bg-black/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/portal/invoicing/${invoice.id}`} className="min-w-0 flex-1 truncate text-sm text-[var(--color-pib-text)] hover:text-[var(--color-accent-v2)]">
            {invoice.invoiceNumber || invoice.id}
          </Link>
          <span className={`pib-pill px-2 py-0.5 text-[10px] ${state.cls}`}>{state.text}</span>
          <span className="font-mono text-sm text-[var(--color-pib-text)]">{money(invoice.total, invoice.currency)}</span>
        </div>

        {p?.reference ? (
          <p className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">
            Ref {p.reference}{p.note ? ` · ${p.note}` : ''}
          </p>
        ) : null}
        {invoice.paymentState === 'rejected' && p?.decisionNote ? (
          <p className="mt-1 rounded border-l-2 border-rose-500 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300">
            {p.decisionNote}
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap gap-2">
          {side === 'payable' && (invoice.paymentState === 'unpaid' || invoice.paymentState === 'rejected') ? (
            <button type="button" onClick={() => void pay(invoice)} disabled={busyId === invoice.id}
              className="rounded-md bg-[var(--color-accent-v2)] px-3 py-1 text-xs font-semibold text-black disabled:opacity-50">
              {busyId === invoice.id ? 'Working…' : 'I have paid this'}
            </button>
          ) : null}

          {side === 'receivable' && invoice.paymentState === 'pending_verification' ? (
            <>
              <button type="button"
                onClick={() => void post(invoice, { action: 'confirm' }, 'Payment confirmed. Invoice settled.')}
                disabled={busyId === invoice.id}
                className="rounded-md bg-[var(--color-accent-v2)] px-3 py-1 text-xs font-semibold text-black disabled:opacity-50">
                Confirm receipt
              </button>
              <button type="button" onClick={() => void reject(invoice)} disabled={busyId === invoice.id}
                className="rounded-md border border-[var(--color-pib-line)] px-3 py-1 text-xs text-[var(--color-pib-text-muted)] transition hover:text-rose-300 disabled:opacity-50">
                Cannot verify
              </button>
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
    <div className="space-y-5 p-4">
      <header>
        <Link href="/portal/partners" className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">
          ← Back to partners
        </Link>
        <p className="eyebrow mt-2">CRM</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-[var(--color-pib-text)]">Partner settlements</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
          Invoices raised from partner orders. Payment is EFT — the payer records the reference, and the org
          that issued the invoice confirms receipt. Only they can mark it settled.
        </p>
      </header>

      {error ? <p className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p> : null}
      {notice ? <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{notice}</p> : null}

      {loading ? (
        <p className="text-sm text-[var(--color-pib-text-muted)]">Loading…</p>
      ) : (
        <>
          <section className={`${CARD} grid gap-4 p-4 sm:grid-cols-2`}>
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">Owed to you</p>
              <p className="mt-1 font-mono text-lg text-[var(--color-pib-text)]">{money(owedToYou, currency)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">You owe</p>
              <p className="mt-1 font-mono text-lg text-[var(--color-pib-text)]">{money(youOwe, currency)}</p>
            </div>
          </section>

          <section className={`${CARD} p-4`}>
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-pib-text)]">
              Owed to you {receivable.length > 0 ? `(${receivable.length})` : ''}
            </h2>
            {receivable.length === 0 ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]">No partner invoices raised yet.</p>
            ) : (
              <ul className="space-y-2">{receivable.map((i) => row(i, 'receivable'))}</ul>
            )}
          </section>

          <section className={`${CARD} p-4`}>
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-pib-text)]">
              You owe {payable.length > 0 ? `(${payable.length})` : ''}
            </h2>
            {payable.length === 0 ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]">Nothing outstanding to partners.</p>
            ) : (
              <ul className="space-y-2">{payable.map((i) => row(i, 'payable'))}</ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
