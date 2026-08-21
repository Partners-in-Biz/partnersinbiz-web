'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'payment_pending_verification' | 'paid' | 'overdue' | 'cancelled'
type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'rejected' | 'expired' | 'converted'
type BillingTab = 'invoices' | 'quotes'

type LineItem = { description?: string; quantity?: number; unitPrice?: number; amount?: number }

interface Invoice {
  id: string
  invoiceNumber?: string
  orgId?: string
  orgName?: string
  status: InvoiceStatus
  total?: number
  subtotal?: number
  taxRate?: number
  taxAmount?: number
  currency?: string
  issueDate?: unknown
  dueDate?: unknown
  paidAt?: unknown
  notes?: string
  lineItems?: LineItem[]
  canEdit?: boolean
  canSend?: boolean
  canCancel?: boolean
  canMarkPaid?: boolean
}

interface Quote {
  id: string
  quoteNumber?: string
  orgId?: string
  status: QuoteStatus
  total?: number
  subtotal?: number
  taxRate?: number
  taxAmount?: number
  currency?: string
  issueDate?: unknown
  validUntil?: unknown
  notes?: string
  lineItems?: LineItem[]
  canEdit?: boolean
  canSend?: boolean
  canAccept?: boolean
  canDecline?: boolean
  canConvertToInvoice?: boolean
}

type DraftForm = { date: string; taxRate: string; notes: string; description: string; quantity: string; unitPrice: string }

type EditingTarget = { kind: BillingTab; id: string } | null

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

const INVOICE_STATUS_MAP: Record<InvoiceStatus, { label: string; pill: string }> = {
  draft: { label: 'Draft', pill: 'pib-pill' },
  sent: { label: 'Sent', pill: 'pib-pill pib-pill-blue' },
  viewed: { label: 'Viewed', pill: 'pib-pill pib-pill-violet' },
  payment_pending_verification: { label: 'Payment review', pill: 'pib-pill pib-pill-warn' },
  paid: { label: 'Paid', pill: 'pib-pill pib-pill-success' },
  overdue: { label: 'Overdue', pill: 'pib-pill pib-pill-danger' },
  cancelled: { label: 'Cancelled', pill: 'pib-pill' },
}

const QUOTE_STATUS_MAP: Record<string, { label: string; pill: string }> = {
  draft: { label: 'Draft', pill: 'pib-pill' },
  sent: { label: 'Sent', pill: 'pib-pill pib-pill-blue' },
  accepted: { label: 'Accepted', pill: 'pib-pill pib-pill-success' },
  declined: { label: 'Declined', pill: 'pib-pill pib-pill-warn' },
  rejected: { label: 'Rejected', pill: 'pib-pill pib-pill-warn' },
  expired: { label: 'Expired', pill: 'pib-pill pib-pill-danger' },
  converted: { label: 'Converted', pill: 'pib-pill pib-pill-violet' },
}

function formatCurrency(amount = 0, currency = 'ZAR') {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency }).format(amount)
}

function formatDate(ts: unknown) {
  if (!ts) return '—'
  const candidate = ts as { _seconds?: number; seconds?: number }
  const d = candidate._seconds || candidate.seconds ? new Date((candidate._seconds ?? candidate.seconds ?? 0) * 1000) : new Date(ts as string)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function dateInputValue(value: unknown): string {
  if (!value) return ''
  const candidate = value as { _seconds?: number; seconds?: number }
  const d = candidate._seconds || candidate.seconds ? new Date((candidate._seconds ?? candidate.seconds ?? 0) * 1000) : new Date(value as string)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function firstLineForm(lineItems?: LineItem[], date?: unknown, taxRate?: number, notes?: string): DraftForm {
  const first = lineItems?.[0]
  return {
    date: dateInputValue(date),
    taxRate: String(taxRate ?? 0),
    notes: notes ?? '',
    description: first?.description ?? '',
    quantity: String(first?.quantity ?? 1),
    unitPrice: String(first?.unitPrice ?? 0),
  }
}

function mergeById<T extends { id: string }>(lists: T[][]): T[] {
  const map = new Map<string, T>()
  for (const list of lists) for (const row of list) map.set(row.id, { ...(map.get(row.id) ?? {}), ...row })
  return Array.from(map.values())
}

async function fetchJson(url: string) {
  const res = await fetch(url)
  if (!res.ok) return null
  return res.json().catch(() => null)
}

export default function InvoicingPage() {
  const [sentInvoices, setSentInvoices] = useState<Invoice[]>([])
  const [receivedInvoices, setReceivedInvoices] = useState<Invoice[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<BillingTab>('invoices')
  const [filter, setFilter] = useState<string>('all')
  const [orgMap, setOrgMap] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<EditingTarget>(null)
  const [draftForm, setDraftForm] = useState<DraftForm>(firstLineForm())
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Merge sent and received for display, but keep ledgers separate for accounting
  const invoices = useMemo(() => mergeById<Invoice>([sentInvoices, receivedInvoices]), [sentInvoices, receivedInvoices])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [sentInvoicesData, receivedInvoicesData, sentQuotes, receivedQuotes, orgs] = await Promise.all([
        fetchJson('/api/v1/invoices'),
        fetchJson('/api/v1/invoices?view=received'),
        fetchJson('/api/v1/quotes'),
        fetchJson('/api/v1/quotes?view=received'),
        fetchJson('/api/v1/organizations'),
      ])
      if (cancelled) return
      setSentInvoices(sentInvoicesData?.data ?? [])
      setReceivedInvoices(receivedInvoicesData?.data ?? [])
      setQuotes(mergeById<Quote>([sentQuotes?.data?.quotes ?? [], receivedQuotes?.data?.quotes ?? []]))
      const map: Record<string, string> = {}
      for (const org of orgs?.data ?? []) map[org.id] = org.name
      setOrgMap(map)
      setLoading(false)
    }
    void load().catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [])

  const visibleInvoices = filter === 'all' ? invoices : invoices.filter(i => i.status === filter)
  const visibleQuotes = filter === 'all' ? quotes : quotes.filter(q => q.status === filter)
  // AR (Accounts Receivable): Revenue from OUR sent invoices (we issued, they pay us)
  // Only count sent invoices that are paid, exclude drafts and received invoices
  const totalRevenue = sentInvoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total ?? 0), 0)
  // AR Outstanding: What customers owe us on sent invoices (sent/viewed/overdue/pending verification)
  const outstanding = sentInvoices.filter(i => ['sent', 'viewed', 'overdue', 'payment_pending_verification'].includes(i.status)).reduce((s, i) => s + (i.total ?? 0), 0)
  const overdueCount = sentInvoices.filter(i => i.status === 'overdue').length
  const filterOptions = useMemo(() => {
    const statuses = tab === 'invoices'
      ? ['draft', 'sent', 'viewed', 'payment_pending_verification', 'paid', 'overdue', 'cancelled']
      : ['draft', 'sent', 'accepted', 'declined', 'rejected', 'expired', 'converted']
    return ['all', ...statuses]
  }, [tab])

  function startInvoiceEdit(invoice: Invoice) {
    setEditing({ kind: 'invoices', id: invoice.id })
    setDraftForm(firstLineForm(invoice.lineItems, invoice.dueDate, invoice.taxRate, invoice.notes))
    setError(null)
  }

  function startQuoteEdit(quote: Quote) {
    setEditing({ kind: 'quotes', id: quote.id })
    setDraftForm(firstLineForm(quote.lineItems, quote.validUntil, quote.taxRate, quote.notes))
    setError(null)
  }

  function optimisticTotals() {
    const quantity = Number(draftForm.quantity) || 1
    const unitPrice = Number(draftForm.unitPrice) || 0
    const taxRate = Number(draftForm.taxRate) || 0
    const subtotal = quantity * unitPrice
    const taxAmount = subtotal * (taxRate / 100)
    return {
      taxRate,
      subtotal,
      taxAmount,
      total: subtotal + taxAmount,
      notes: draftForm.notes,
      lineItems: [{ description: draftForm.description.trim() || 'Billing item', quantity, unitPrice, amount: subtotal }],
    }
  }

  async function patchInvoice(invoice: Invoice, body: Record<string, unknown>) {
    setSavingId(invoice.id)
    setError(null)
    const res = await fetch(`/api/v1/invoices/${invoice.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) {
      const resBody = await res.json().catch(() => ({})) as { error?: string }
      setError(resBody.error ?? 'Failed to update invoice')
      setSavingId(null)
      return
    }
    // Update both ledgers (sent and received) as the same invoice may appear in both
    setSentInvoices(current => current.map(item => item.id === invoice.id ? { ...item, ...body } : item))
    setReceivedInvoices(current => current.map(item => item.id === invoice.id ? { ...item, ...body } : item))
    setEditing(null)
    setSavingId(null)
  }

  async function patchQuote(quote: Quote, body: Record<string, unknown>) {
    setSavingId(quote.id)
    setError(null)
    const res = await fetch(`/api/v1/quotes/${quote.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) {
      const resBody = await res.json().catch(() => ({})) as { error?: string }
      setError(resBody.error ?? 'Failed to update quote')
      setSavingId(null)
      return
    }
    setQuotes(current => current.map(item => item.id === quote.id ? { ...item, ...body } : item))
    setEditing(null)
    setSavingId(null)
  }

  async function saveInvoiceDraft(invoice: Invoice) {
    await patchInvoice(invoice, { dueDate: draftForm.date || null, ...optimisticTotals() })
  }

  async function saveQuoteDraft(quote: Quote) {
    await patchQuote(quote, { validUntil: draftForm.date || null, ...optimisticTotals() })
  }

  const renderDraftEditor = (onSave: () => void) => (
    <div className="col-span-12 rounded-2xl border border-[var(--color-pib-line)] p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="pib-label">Date
          <input type="date" value={draftForm.date} onChange={e => setDraftForm(c => ({ ...c, date: e.target.value }))} className="pib-input mt-1 w-full" />
        </label>
        <label className="pib-label">Tax rate
          <input type="number" min="0" max="100" value={draftForm.taxRate} onChange={e => setDraftForm(c => ({ ...c, taxRate: e.target.value }))} className="pib-input mt-1 w-full" />
        </label>
        <label className="pib-label sm:col-span-2">Line item description
          <input value={draftForm.description} onChange={e => setDraftForm(c => ({ ...c, description: e.target.value }))} className="pib-input mt-1 w-full" />
        </label>
        <label className="pib-label">Quantity
          <input type="number" min="1" value={draftForm.quantity} onChange={e => setDraftForm(c => ({ ...c, quantity: e.target.value }))} className="pib-input mt-1 w-full" />
        </label>
        <label className="pib-label">Unit price
          <input type="number" min="0" step="0.01" value={draftForm.unitPrice} onChange={e => setDraftForm(c => ({ ...c, unitPrice: e.target.value }))} className="pib-input mt-1 w-full" />
        </label>
        <label className="pib-label sm:col-span-2">Notes
          <textarea value={draftForm.notes} onChange={e => setDraftForm(c => ({ ...c, notes: e.target.value }))} className="pib-textarea mt-1 w-full" rows={2} />
        </label>
      </div>
      {error ? <p className="mt-3 text-xs text-[var(--color-error)]">{error}</p> : null}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={() => setEditing(null)} className="btn-pib-ghost">Cancel</button>
        <button type="button" onClick={onSave} disabled={Boolean(savingId)} className="btn-pib-primary">
          {savingId ? 'Saving…' : 'Save Draft'}
        </button>
      </div>
    </div>
  )

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Invoicing · Billing</p>
          <h1 className="pib-page-title mt-2">Billing</h1>
          <p className="pib-page-sub">{loading ? '—' : `${invoices.length} invoices · ${quotes.length} quotes`}</p>
        </div>
        <Link href="/portal/invoicing/new" className="btn-pib-primary">+ New Invoice</Link>
      </header>

      {!loading && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="pib-stat-card"><p className="pib-label mb-1">Revenue Collected</p><p className="text-2xl font-semibold text-[var(--color-pib-accent)]">{formatCurrency(totalRevenue, 'ZAR')}</p></div>
          <div className="pib-stat-card"><p className="pib-label mb-1">Outstanding</p><p className="text-2xl font-semibold">{formatCurrency(outstanding, 'ZAR')}</p></div>
          <div className="pib-stat-card"><p className="pib-label mb-1">Overdue</p><p className={`text-2xl font-semibold ${overdueCount > 0 ? 'text-[var(--color-error)]' : ''}`}>{overdueCount}</p></div>
        </div>
      )}

      <div role="tablist" aria-label="Billing tabs" className="pib-tabs pib-tabs-segmented">
        {(['invoices', 'quotes'] as const).map(nextTab => (
          <button key={nextTab} type="button" role="tab" aria-selected={tab === nextTab} onClick={() => { setTab(nextTab); setFilter('all'); setEditing(null) }} className={`pib-tab capitalize ${tab === nextTab ? 'pib-tab-active' : ''}`}>
            {nextTab === 'invoices' ? `Invoices (${invoices.length})` : `Quotes (${quotes.length})`}
          </button>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        {filterOptions.map(s => (
          <button key={s} onClick={() => setFilter(s)} className={`capitalize transition-colors ${filter === s ? 'pib-pill pib-pill-cyan' : 'pib-pill'}`}>
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <div className="pib-surface pib-surface-table overflow-hidden">
        <div className="grid grid-cols-12 gap-4 border-b border-[var(--color-pib-line)] px-5 py-3">
          <p className="col-span-2 pib-label">#</p>
          <p className="col-span-3 pib-label">Client</p>
          <p className="col-span-2 pib-label">Status</p>
          <p className="col-span-2 pib-label">Amount</p>
          <p className="col-span-1 pib-label">Date</p>
          <p className="col-span-2 pib-label text-right">Actions</p>
        </div>

        {loading ? (
          <div className="divide-y divide-[var(--color-pib-line)]">{[1, 2, 3].map(i => <div key={i} className="px-5 py-4"><Skeleton className="h-5 w-48" /></div>)}</div>
        ) : tab === 'invoices' ? (
          visibleInvoices.length === 0 ? <EmptyState label="No invoices found." /> : <div className="divide-y divide-[var(--color-pib-line)]">{visibleInvoices.map(inv => {
            const status = INVOICE_STATUS_MAP[inv.status] ?? { label: inv.status, pill: 'pib-pill' }
            return <div key={inv.id} className="grid grid-cols-12 items-center gap-4 px-5 py-3 transition-colors hover:bg-[var(--color-row-hover)]">
              <p className="col-span-2 font-mono text-sm">{inv.invoiceNumber ?? inv.id}</p>
              <p className="col-span-3 truncate text-sm">{orgMap[inv.orgId ?? ''] ?? inv.orgId ?? '—'}</p>
              <div className="col-span-2"><StatusPill status={status} /></div>
              <p className="col-span-2 text-sm font-medium">{formatCurrency(inv.total ?? 0, inv.currency ?? 'ZAR')}</p>
              <p className="col-span-1 text-sm text-[var(--color-pib-text-muted)]">{formatDate(inv.dueDate)}</p>
              <div className="col-span-2 flex flex-wrap justify-end gap-2 text-[10px] font-label uppercase tracking-wide">
                {inv.canEdit ? <button type="button" onClick={() => startInvoiceEdit(inv)} className="text-[var(--color-pib-accent)]">Edit</button> : null}
                {inv.canSend ? <button type="button" onClick={() => patchInvoice(inv, { status: 'sent' })} disabled={savingId === inv.id} className="text-[var(--color-pib-accent)]">Mark sent</button> : null}
                {inv.canCancel ? <button type="button" onClick={() => patchInvoice(inv, { status: 'cancelled' })} disabled={savingId === inv.id} className="text-[var(--color-error)]">Cancel</button> : null}
                <Link href={`/portal/invoicing/${inv.id}`} className="text-[var(--color-pib-accent)]">View</Link>
              </div>
              {editing?.kind === 'invoices' && editing.id === inv.id ? renderDraftEditor(() => saveInvoiceDraft(inv)) : null}
            </div>
          })}</div>
        ) : (
          visibleQuotes.length === 0 ? <EmptyState label="No quotes found." /> : <div className="divide-y divide-[var(--color-pib-line)]">{visibleQuotes.map(quote => {
            const status = QUOTE_STATUS_MAP[quote.status] ?? { label: quote.status, pill: 'pib-pill' }
            return <div key={quote.id} className="grid grid-cols-12 items-center gap-4 px-5 py-3 transition-colors hover:bg-[var(--color-row-hover)]">
              <p className="col-span-2 font-mono text-sm">{quote.quoteNumber ?? quote.id}</p>
              <p className="col-span-3 truncate text-sm">{orgMap[quote.orgId ?? ''] ?? quote.orgId ?? '—'}</p>
              <div className="col-span-2"><StatusPill status={status} /></div>
              <p className="col-span-2 text-sm font-medium">{formatCurrency(quote.total ?? 0, quote.currency ?? 'ZAR')}</p>
              <p className="col-span-1 text-sm text-[var(--color-pib-text-muted)]">{formatDate(quote.validUntil)}</p>
              <div className="col-span-2 flex flex-wrap justify-end gap-2 text-[10px] font-label uppercase tracking-wide">
                {quote.canEdit ? <button type="button" onClick={() => startQuoteEdit(quote)} className="text-[var(--color-pib-accent)]">Edit</button> : null}
                {quote.canSend ? <button type="button" onClick={() => patchQuote(quote, { status: 'sent' })} disabled={savingId === quote.id} className="text-[var(--color-pib-accent)]">Send</button> : null}
                {quote.canAccept ? <button type="button" onClick={() => patchQuote(quote, { status: 'accepted' })} disabled={savingId === quote.id} className="text-[var(--color-pib-accent)]">Accept</button> : null}
                {quote.canDecline ? <button type="button" onClick={() => patchQuote(quote, { status: 'declined' })} disabled={savingId === quote.id} className="text-[var(--color-error)]">Decline</button> : null}
              </div>
              {editing?.kind === 'quotes' && editing.id === quote.id ? renderDraftEditor(() => saveQuoteDraft(quote)) : null}
            </div>
          })}</div>
        )}
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: { label: string; pill: string } }) {
  return <span className={status.pill}>{status.label}</span>
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="pib-empty-state border-0">
      <h2 className="pib-empty-state-title">{label}</h2>
      <div className="mt-5 flex justify-center">
        <Link href="/portal/invoicing/new" className="btn-pib-secondary">Create your first invoice →</Link>
      </div>
    </div>
  )
}
