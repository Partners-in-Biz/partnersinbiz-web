'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { EmptyState, PageHeader, PageTabs, StatusPill, Surface } from '@/components/ui/AppFoundation'
import { StatCard } from '@/components/ui/StatCard'
import { ThemedSelect } from '@/components/ui/ThemedSelect'
import { Button, Icon, Skeleton } from '@/components/studio'
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
  taxRate?: number
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

const INVOICE_STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'danger' | 'warn'> = {
  draft: 'neutral',
  sent: 'info',
  viewed: 'info',
  payment_pending_verification: 'info',
  paid: 'success',
  partially_paid: 'success',
  overdue: 'danger',
  cancelled: 'neutral',
}

const INVOICE_STATUS_OPTIONS: InvoiceStatus[] = [
  'draft',
  'sent',
  'viewed',
  'payment_pending_verification',
  'partially_paid',
  'paid',
  'overdue',
  'cancelled',
]

const QUOTE_STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'danger'> = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'success',
  converted: 'success',
  declined: 'danger',
  rejected: 'danger',
  expired: 'neutral',
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
    setUpdatingInvoiceId(invoiceId)
    try {
      if (status === 'paid') {
        const res = await fetch(scopedApiPath(`/api/v1/invoices/${invoiceId}/mark-paid`, orgScope), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentMethod: 'other' }),
        })
        if (res.ok) {
          setInvoices((prev) => prev.map((invoice) => (invoice.id === invoiceId ? { ...invoice, status: 'paid' } : invoice)))
        }
        return
      }

      const res = await fetch(scopedApiPath(`/api/v1/invoices/${invoiceId}`, orgScope), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        setInvoices((prev) => prev.map((invoice) => (invoice.id === invoiceId ? { ...invoice, status } : invoice)))
      }
    } finally {
      setUpdatingInvoiceId(null)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Finance operations"
        title="Finance command center."
        description="Track invoices, quote decisions, and payment pressure for the active company workspace."
      />

      {!loading ? (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Workspace" value={workspaceLabel} detail="Scoped finance view" />
          <StatCard
            label="Revenue protected"
            value={formatCurrency(totals.totalPaid, currency)}
            detail={`${invoices.filter((invoice) => invoice.status === 'paid').length} invoices`}
          />
          <StatCard
            label="Payment risk"
            value={formatCurrency(totals.totalOutstanding, currency)}
            detail={`${totals.overdueInvoices} overdue invoices`}
          />
          <StatCard
            label="Decision pipeline"
            value={formatCurrency(totals.pendingQuotes, currency)}
            detail={`${totals.openQuotes} quotes awaiting response`}
          />
        </section>
      ) : null}

      <PageTabs
        ariaLabel="Billing document type"
        value={tab}
        onValueChange={(value) => setTab(value as BillingTab)}
        tabs={[
          { value: 'invoices', label: label('invoices') },
          { value: 'quotes', label: label('quotes') },
        ]}
      />

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : tab === 'invoices' ? (
        invoices.length === 0 ? (
          <EmptyState
            title="No invoices issued yet."
            description="Invoices will appear here once they are issued to this workspace."
          />
        ) : (
          <Surface>
            <div className="hidden md:grid grid-cols-12 gap-4 border-b border-[var(--sc-line)] px-5 py-3.5">
              <p className="col-span-3 sc-tiny">Invoice</p>
              <p className="col-span-2 sc-tiny">Issued</p>
              <p className="col-span-2 sc-tiny">Due</p>
              <p className="col-span-2 sc-tiny">Amount</p>
              <p className="col-span-2 sc-tiny">Status</p>
              <p className="col-span-1 sc-tiny text-right">Actions</p>
            </div>
            <div className="divide-y divide-[var(--sc-line)]">
              {invoices.map((invoice) => (
                <div key={invoice.id} className="grid grid-cols-2 items-center gap-3 px-5 py-4 md:grid-cols-12 md:gap-4 hover:bg-[color-mix(in_srgb,var(--sc-ink)_4%,transparent)]">
                  <div className="col-span-2 md:col-span-3">
                    {invoice.status === 'draft' ? (
                      <Link
                        href={scopedPortalPath(`/portal/invoicing/${invoice.id}?edit=draft`, orgScope)}
                        className="font-mono text-sm text-[var(--sc-ink)] underline-offset-2 hover:underline"
                        aria-label={`Edit draft invoice ${invoice.invoiceNumber}`}
                      >
                        {invoice.invoiceNumber}
                      </Link>
                    ) : (
                      <p className="font-mono text-sm">{invoice.invoiceNumber}</p>
                    )}
                  </div>
                  <div className="md:col-span-2"><p className="sc-body text-[0.875rem] text-[var(--sc-ink-soft)]">{formatDate(invoice.issueDate)}</p></div>
                  <div className="md:col-span-2"><p className="sc-body text-[0.875rem] text-[var(--sc-ink-soft)]">{formatDate(invoice.dueDate)}</p></div>
                  <div className="md:col-span-2">
                    <p className="st-num text-[1.125rem] text-[var(--sc-ink)]">{formatCurrency(invoice.total ?? 0, invoice.currency ?? 'ZAR')}</p>
                    {typeof invoice.taxRate === 'number' && invoice.taxRate > 0 ? (
                      <p className="mt-1 sc-tiny text-[var(--sc-ink-soft)]">VAT {invoice.taxRate}%</p>
                    ) : null}
                  </div>
                  <div className="col-span-2 md:col-span-2">
                    {invoice.status === 'paid' ? (
                      <StatusPill
                        data-testid={`invoice-status-pill-${invoice.invoiceNumber}`}
                        tone={INVOICE_STATUS_TONE[invoice.status]}
                      >
                        {label(invoice.status)}
                      </StatusPill>
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
                          'st-status sc-tiny inline-flex h-7 items-center justify-between gap-1.5 pr-1 transition-colors focus:outline-none disabled:cursor-not-allowed',
                          updatingInvoiceId === invoice.id ? 'opacity-60' : '',
                        ].join(' ')}
                        valueClassName="inline-flex items-center gap-1.5"
                        menuClassName="min-w-max bg-[var(--sc-surface)] text-[var(--sc-ink)]"
                        renderValue={() => label(invoice.status)}
                      />
                    )}
                  </div>
                  <div className="col-span-2 flex md:col-span-1 md:justify-end">
                    <div className="flex items-center gap-3">
                      {invoice.status !== 'draft' ? (
                        <Link
                          href={scopedPortalPath(`/portal/invoicing/${invoice.id}`, orgScope)}
                          className="sc-tiny text-[var(--sc-ink-soft)] hover:text-[var(--sc-ink)]"
                          aria-label={`Open invoice ${invoice.invoiceNumber}`}
                        >
                          Open
                        </Link>
                      ) : null}
                      <a
                        href={scopedApiPath(`/api/v1/invoices/${invoice.id}/pdf`, orgScope)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="sc-tiny inline-flex items-center gap-1 text-[var(--sc-ink)] hover:underline"
                        aria-label={`Download ${invoice.invoiceNumber} PDF`}
                      >
                        PDF
                        <Icon name="arrow_outward" />
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Surface>
        )
      ) : quotes.length === 0 ? (
        <EmptyState
          title="No quotes received yet."
          description="Quotes will appear here when Partners in Biz sends them to this workspace."
        />
      ) : (
        <Surface>
          <div className="hidden md:grid grid-cols-12 gap-4 border-b border-[var(--sc-line)] px-5 py-3.5">
            <p className="col-span-3 sc-tiny">Quote</p>
            <p className="col-span-2 sc-tiny">Issued</p>
            <p className="col-span-2 sc-tiny">Valid until</p>
            <p className="col-span-2 sc-tiny">Amount</p>
            <p className="col-span-1 sc-tiny">Status</p>
            <p className="col-span-2 sc-tiny text-right">Actions</p>
          </div>
          <div className="divide-y divide-[var(--sc-line)]">
            {quotes.map((quote) => (
              <div key={quote.id} className="grid grid-cols-2 items-center gap-3 px-5 py-4 md:grid-cols-12 md:gap-4 hover:bg-[color-mix(in_srgb,var(--sc-ink)_4%,transparent)]">
                <div className="col-span-2 md:col-span-3"><p className="font-mono text-sm">{quote.quoteNumber}</p></div>
                <div className="md:col-span-2"><p className="sc-body text-[0.875rem] text-[var(--sc-ink-soft)]">{formatDate(quote.issueDate)}</p></div>
                <div className="md:col-span-2"><p className="sc-body text-[0.875rem] text-[var(--sc-ink-soft)]">{formatDate(quote.validUntil)}</p></div>
                <div className="md:col-span-2"><p className="st-num text-[1.125rem] text-[var(--sc-ink)]">{formatCurrency(quote.total ?? 0, quote.currency ?? 'ZAR')}</p></div>
                <div className="col-span-2 md:col-span-1">
                  <StatusPill tone={QUOTE_STATUS_TONE[quote.status]}>{label(quote.status)}</StatusPill>
                </div>
                <div className="col-span-2 flex flex-wrap justify-start gap-2 md:col-span-2 md:justify-end">
                  {quote.status === 'sent' ? (
                    <>
                      <Button type="button" size="sm" onClick={() => updateQuoteStatus(quote.id, 'accepted')} disabled={updatingQuoteId === quote.id} aria-label={`Accept quote ${quote.quoteNumber}`}>
                        Accept
                      </Button>
                      <Button type="button" variant="secondary" size="sm" onClick={() => updateQuoteStatus(quote.id, 'declined')} disabled={updatingQuoteId === quote.id} aria-label={`Decline quote ${quote.quoteNumber}`}>
                        Decline
                      </Button>
                    </>
                  ) : (
                    <span className="sc-tiny text-[var(--sc-ink-soft)]">No action</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Surface>
      )}
    </div>
  )
}
