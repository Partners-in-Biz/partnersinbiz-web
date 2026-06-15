'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { PageTabs } from '@/components/ui/AppFoundation'
import { ThemedSelect } from '@/components/ui/ThemedSelect'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

type BillingTab = 'invoices' | 'quotes'
type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'payment_pending_verification' | 'paid' | 'partially_paid' | 'overdue' | 'cancelled'
type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'rejected' | 'expired' | 'converted'

interface Invoice {
  id: string
  invoiceNumber: string
  status: InvoiceStatus
  total: number
  currency: string
  issueDate?: unknown
  dueDate?: unknown
}

interface Quote {
  id: string
  quoteNumber: string
  status: QuoteStatus
  total: number
  currency: string
  issueDate?: unknown
  validUntil?: unknown
  clientDetails?: { name?: string }
}

const INVOICE_STATUS_PILL: Record<string, string> = {
  draft: 'pib-pill',
  sent: 'pib-pill pib-pill-info',
  viewed: 'pib-pill pib-pill-info',
  payment_pending_verification: 'pib-pill pib-pill-info',
  paid: 'pib-pill pib-pill-success',
  partially_paid: 'pib-pill pib-pill-success',
  overdue: 'pib-pill pib-pill-danger',
  cancelled: 'pib-pill',
}

const INVOICE_STATUS_OPTIONS: InvoiceStatus[] = [
  'draft',
  'sent',
  'viewed',
  'payment_pending_verification',
  'partially_paid',
  'overdue',
  'cancelled',
]

const QUOTE_STATUS_PILL: Record<string, string> = {
  draft: 'pib-pill',
  sent: 'pib-pill pib-pill-info',
  accepted: 'pib-pill pib-pill-success',
  converted: 'pib-pill pib-pill-success',
  declined: 'pib-pill pib-pill-danger',
  rejected: 'pib-pill pib-pill-danger',
  expired: 'pib-pill',
}

function label(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
}

function formatDate(ts: unknown) {
  if (!ts) return '-'
  if (typeof ts === 'object') {
    const source = ts as { _seconds?: number; seconds?: number; toDate?: () => Date }
    if (typeof source.toDate === 'function') return source.toDate().toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
    const secs = source._seconds ?? source.seconds
    if (typeof secs === 'number') return new Date(secs * 1000).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  return new Date(ts as string | number | Date).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

function extractQuotes(body: unknown): Quote[] {
  if (!body || typeof body !== 'object') return []
  const data = (body as { data?: unknown }).data
  if (Array.isArray(data)) return data as Quote[]
  if (data && typeof data === 'object' && Array.isArray((data as { quotes?: unknown }).quotes)) {
    return (data as { quotes: Quote[] }).quotes
  }
  return []
}

export default function PaymentsPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const [tab, setTab] = useState<BillingTab>('invoices')
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingInvoiceId, setUpdatingInvoiceId] = useState<string | null>(null)
  const [updatingQuoteId, setUpdatingQuoteId] = useState<string | null>(null)
  const workspaceLabel = orgScope.sourceCompanyName ? `${orgScope.sourceCompanyName} workspace` : 'Active workspace'
  const billingApiPath = useMemo(
    () => ({
      invoices: scopedApiPath('/api/v1/invoices?view=received', orgScope),
      quotes: scopedApiPath('/api/v1/quotes?view=received', orgScope),
    }),
    [orgScope],
  )

  useEffect(() => {
    let cancelled = false
    async function fetchBilling() {
      setLoading(true)
      try {
        const [invoiceRes, quoteRes] = await Promise.all([
          fetch(billingApiPath.invoices),
          fetch(billingApiPath.quotes),
        ])
        const [invoiceBody, quoteBody] = await Promise.all([
          invoiceRes.ok ? invoiceRes.json() : Promise.resolve({ data: [] }),
          quoteRes.ok ? quoteRes.json() : Promise.resolve({ data: { quotes: [] } }),
        ])
        if (cancelled) return
        setInvoices(Array.isArray(invoiceBody?.data) ? invoiceBody.data : [])
        setQuotes(extractQuotes(quoteBody))
      } catch (error) {
        console.error('Error fetching billing records:', error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchBilling()
    return () => { cancelled = true }
  }, [billingApiPath])

  const currency = invoices[0]?.currency ?? quotes[0]?.currency ?? 'ZAR'
  const totals = useMemo(() => {
    const totalPaid = invoices
      .filter((invoice) => invoice.status === 'paid' || invoice.status === 'partially_paid')
      .reduce((sum, invoice) => sum + (invoice.total || 0), 0)
    const totalOutstanding = invoices
      .filter((invoice) => ['sent', 'viewed', 'overdue', 'payment_pending_verification'].includes(invoice.status))
      .reduce((sum, invoice) => sum + (invoice.total || 0), 0)
    const pendingQuotes = quotes
      .filter((quote) => quote.status === 'sent')
      .reduce((sum, quote) => sum + (quote.total || 0), 0)
    const overdueInvoices = invoices.filter((invoice) => invoice.status === 'overdue').length
    const openQuotes = quotes.filter((quote) => quote.status === 'sent').length
    return { totalPaid, totalOutstanding, pendingQuotes, overdueInvoices, openQuotes }
  }, [invoices, quotes])

  async function updateQuoteStatus(quoteId: string, status: QuoteStatus) {
    setUpdatingQuoteId(quoteId)
    try {
      const res = await fetch(scopedApiPath(`/api/v1/quotes/${quoteId}`, orgScope), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        setQuotes(prev => prev.map(quote => quote.id === quoteId ? { ...quote, status } : quote))
      }
    } finally {
      setUpdatingQuoteId(null)
    }
  }

  async function updateInvoiceStatus(invoiceId: string, status: InvoiceStatus) {
    if (status === 'paid') return
    setUpdatingInvoiceId(invoiceId)
    try {
      const res = await fetch(scopedApiPath(`/api/v1/invoices/${invoiceId}`, orgScope), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        setInvoices(prev => prev.map(invoice => invoice.id === invoiceId ? { ...invoice, status } : invoice))
      }
    } finally {
      setUpdatingInvoiceId(null)
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">Finance operations</p>
        <h1 className="pib-page-title mt-2">Finance command center</h1>
        <p className="pib-page-sub max-w-3xl">
          Track invoices, quote decisions, and payment pressure for the active company workspace.
        </p>
      </header>

      {!loading && (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="pib-stat-card">
            <p className="eyebrow !text-[10px]">Workspace</p>
            <p className="font-display text-xl mt-3 text-[var(--color-pib-text)]">{workspaceLabel}</p>
            <p className="mt-2 text-xs text-[var(--color-pib-text-muted)] font-mono">scoped finance view</p>
          </div>
          <div className="pib-stat-card">
            <p className="eyebrow !text-[10px]">Revenue protected</p>
            <p className="font-display text-3xl mt-3 text-[var(--color-pib-success)]">{formatCurrency(totals.totalPaid, currency)}</p>
            <p className="mt-2 text-xs text-[var(--color-pib-text-muted)] font-mono">{invoices.filter((invoice) => invoice.status === 'paid').length} invoices</p>
          </div>
          <div className="pib-stat-card">
            <p className="eyebrow !text-[10px]">Payment risk</p>
            <p className="font-display text-3xl mt-3 text-[var(--color-pib-accent)]">{formatCurrency(totals.totalOutstanding, currency)}</p>
            <p className="mt-2 text-xs text-[var(--color-pib-text-muted)] font-mono">{totals.overdueInvoices} overdue invoices</p>
          </div>
          <div className="pib-stat-card">
            <p className="eyebrow !text-[10px]">Decision pipeline</p>
            <p className="font-display text-3xl mt-3">{formatCurrency(totals.pendingQuotes, currency)}</p>
            <p className="mt-2 text-xs text-[var(--color-pib-text-muted)] font-mono">{totals.openQuotes} quotes awaiting response</p>
          </div>
        </section>
      )}

      <PageTabs
        variant="segmented"
        ariaLabel="Billing document type"
        value={tab}
        onValueChange={(value) => setTab(value as BillingTab)}
        tabs={[
          { value: 'invoices', label: label('invoices') },
          { value: 'quotes', label: label('quotes') },
        ]}
      />

      {loading ? (
        <div className="pib-skeleton h-64" />
      ) : tab === 'invoices' ? (
        invoices.length === 0 ? (
          <div className="bento-card p-10 text-center">
            <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">receipt_long</span>
            <h2 className="font-display text-2xl mt-4">No invoices issued yet.</h2>
            <p className="text-sm text-[var(--color-pib-text-muted)] mt-2">Invoices will appear here once they are issued to this workspace.</p>
          </div>
        ) : (
          <div className="pib-card-section">
            <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-3.5 border-b border-[var(--color-pib-line)] bg-white/[0.02]">
              <p className="col-span-3 eyebrow !text-[10px]">Invoice</p>
              <p className="col-span-2 eyebrow !text-[10px]">Issued</p>
              <p className="col-span-2 eyebrow !text-[10px]">Due</p>
              <p className="col-span-2 eyebrow !text-[10px]">Amount</p>
              <p className="col-span-2 eyebrow !text-[10px]">Status</p>
              <p className="col-span-1 eyebrow !text-[10px] text-right">Actions</p>
            </div>
            <div className="divide-y divide-[var(--color-pib-line)]">
              {invoices.map((invoice) => (
                <div key={invoice.id} className="grid grid-cols-2 md:grid-cols-12 gap-3 md:gap-4 items-center px-5 py-4 hover:bg-[var(--color-pib-surface-2)] transition-colors">
                  <div className="col-span-2 md:col-span-3">
                    {invoice.status === 'draft' ? (
                      <Link
                        href={scopedPortalPath(`/portal/invoicing/${invoice.id}?edit=draft`, orgScope)}
                        className="font-mono text-sm text-[var(--color-pib-accent-hover)] transition-colors hover:text-[var(--color-pib-accent)] hover:underline"
                        aria-label={`Edit draft invoice ${invoice.invoiceNumber}`}
                      >
                        {invoice.invoiceNumber}
                      </Link>
                    ) : (
                      <p className="font-mono text-sm">{invoice.invoiceNumber}</p>
                    )}
                  </div>
                  <div className="md:col-span-2"><p className="text-sm text-[var(--color-pib-text-muted)]">{formatDate(invoice.issueDate)}</p></div>
                  <div className="md:col-span-2"><p className="text-sm text-[var(--color-pib-text-muted)]">{formatDate(invoice.dueDate)}</p></div>
                  <div className="md:col-span-2"><p className="text-sm font-display text-lg">{formatCurrency(invoice.total ?? 0, invoice.currency ?? 'ZAR')}</p></div>
                  <div className="col-span-2 md:col-span-2">
                    {invoice.status === 'paid' ? (
                      <span className={INVOICE_STATUS_PILL[invoice.status] ?? 'pib-pill'}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {label(invoice.status)}
                      </span>
                    ) : (
                      <ThemedSelect
                        ariaLabel={`Change status for invoice ${invoice.invoiceNumber}`}
                        value={invoice.status}
                        options={INVOICE_STATUS_OPTIONS.map((status) => ({ value: status, label: label(status) }))}
                        onValueChange={(status) => updateInvoiceStatus(invoice.id, status as InvoiceStatus)}
                        disabled={updatingInvoiceId === invoice.id}
                        buttonTestId={`invoice-status-pill-${invoice.invoiceNumber}`}
                        buttonChrome="custom"
                        className="w-fit"
                        buttonClassName={[
                          INVOICE_STATUS_PILL[invoice.status] ?? 'pib-pill',
                          'inline-flex h-7 items-center justify-between gap-1.5 pr-1 transition-colors focus:border-[var(--color-pib-accent)] focus:outline-none disabled:cursor-not-allowed',
                          updatingInvoiceId === invoice.id ? 'opacity-60' : '',
                        ].join(' ')}
                        valueClassName="inline-flex items-center gap-1.5"
                        menuClassName="min-w-max bg-[var(--color-pib-surface)] text-[var(--color-pib-text)]"
                        renderValue={() => (
                          <>
                            <span className="w-1.5 h-1.5 rounded-full bg-current" />
                            {label(invoice.status)}
                          </>
                        )}
                      />
                    )}
                  </div>
                  <div className="col-span-2 md:col-span-1 flex md:justify-end">
                    <a href={scopedApiPath(`/api/v1/invoices/${invoice.id}/pdf`, orgScope)} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--color-pib-accent-hover)] hover:text-[var(--color-pib-accent)] inline-flex items-center gap-1 font-mono uppercase tracking-widest" aria-label={`Download ${invoice.invoiceNumber} PDF`}>
                      PDF
                      <span className="material-symbols-outlined text-sm">arrow_outward</span>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      ) : quotes.length === 0 ? (
        <div className="bento-card p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">request_quote</span>
          <h2 className="font-display text-2xl mt-4">No quotes received yet.</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-2">Quotes will appear here when Partners in Biz sends them to this workspace.</p>
        </div>
      ) : (
        <div className="pib-card-section">
          <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-3.5 border-b border-[var(--color-pib-line)] bg-white/[0.02]">
            <p className="col-span-3 eyebrow !text-[10px]">Quote</p>
            <p className="col-span-2 eyebrow !text-[10px]">Issued</p>
            <p className="col-span-2 eyebrow !text-[10px]">Valid Until</p>
            <p className="col-span-2 eyebrow !text-[10px]">Amount</p>
            <p className="col-span-1 eyebrow !text-[10px]">Status</p>
            <p className="col-span-2 eyebrow !text-[10px] text-right">Actions</p>
          </div>
          <div className="divide-y divide-[var(--color-pib-line)]">
            {quotes.map((quote) => (
              <div key={quote.id} className="grid grid-cols-2 md:grid-cols-12 gap-3 md:gap-4 items-center px-5 py-4 hover:bg-[var(--color-pib-surface-2)] transition-colors">
                <div className="col-span-2 md:col-span-3"><p className="font-mono text-sm">{quote.quoteNumber}</p></div>
                <div className="md:col-span-2"><p className="text-sm text-[var(--color-pib-text-muted)]">{formatDate(quote.issueDate)}</p></div>
                <div className="md:col-span-2"><p className="text-sm text-[var(--color-pib-text-muted)]">{formatDate(quote.validUntil)}</p></div>
                <div className="md:col-span-2"><p className="text-sm font-display text-lg">{formatCurrency(quote.total ?? 0, quote.currency ?? 'ZAR')}</p></div>
                <div className="col-span-2 md:col-span-1"><span className={QUOTE_STATUS_PILL[quote.status] ?? 'pib-pill'}><span className="w-1.5 h-1.5 rounded-full bg-current" />{label(quote.status)}</span></div>
                <div className="col-span-2 md:col-span-2 flex flex-wrap justify-start gap-2 md:justify-end">
                  {quote.status === 'sent' ? (
                    <>
                      <button type="button" onClick={() => updateQuoteStatus(quote.id, 'accepted')} disabled={updatingQuoteId === quote.id} className="pib-btn-primary !px-3 !py-1.5 text-xs" aria-label={`Accept quote ${quote.quoteNumber}`}>Accept</button>
                      <button type="button" onClick={() => updateQuoteStatus(quote.id, 'declined')} disabled={updatingQuoteId === quote.id} className="pib-btn-secondary !px-3 !py-1.5 text-xs" aria-label={`Decline quote ${quote.quoteNumber}`}>Decline</button>
                    </>
                  ) : (
                    <span className="text-xs text-[var(--color-pib-text-muted)]">No action</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
