'use client'
export const dynamic = 'force-dynamic'

import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { EmptyState, PageHeader, PageTabs } from '@/components/ui/AppFoundation'
import { StatCard } from '@/components/ui/StatCard'
import {
  Button,
  ButtonLink,
  Field,
  Input,
  Notice,
  Panel,
  Skeleton,
  Status,
  Table,
  THead,
  TR,
  TH,
  TD,
  Textarea,
  Toolbar,
} from '@/components/studio'

type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'payment_pending_verification' | 'paid' | 'overdue' | 'cancelled'
type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'rejected' | 'expired' | 'converted'
type BillingTab = 'invoices' | 'quotes'
type StatusTone = 'success' | 'warning' | 'danger' | 'info' | undefined

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

const INVOICE_STATUS_TONE: Record<InvoiceStatus, StatusTone> = {
  draft: undefined,
  sent: 'info',
  viewed: 'info',
  payment_pending_verification: 'warning',
  paid: 'success',
  overdue: 'danger',
  cancelled: undefined,
}

const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  payment_pending_verification: 'Payment review',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
}

const QUOTE_STATUS_TONE: Record<string, StatusTone> = {
  draft: undefined,
  sent: 'info',
  accepted: 'success',
  declined: 'warning',
  rejected: 'warning',
  expired: 'danger',
  converted: 'info',
}

const QUOTE_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  rejected: 'Rejected',
  expired: 'Expired',
  converted: 'Converted',
}

function formatCurrency(amount = 0, currency = 'ZAR') {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency }).format(amount)
}

function formatDate(ts: unknown) {
  if (!ts) return '-'
  const candidate = ts as { _seconds?: number; seconds?: number }
  const d = candidate._seconds || candidate.seconds ? new Date((candidate._seconds ?? candidate.seconds ?? 0) * 1000) : new Date(ts as string)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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

function filterLabel(value: string) {
  return value === 'all' ? 'All' : value.replace(/_/g, ' ')
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
  const totalRevenue = sentInvoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total ?? 0), 0)
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
    <Panel flat className="space-y-4 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="draft-date" label="Date">
          <Input id="draft-date" type="date" value={draftForm.date} aria-label="Date" onChange={e => setDraftForm(c => ({ ...c, date: e.target.value }))} />
        </Field>
        <Field id="draft-tax" label="Tax rate">
          <Input id="draft-tax" type="number" min="0" max="100" value={draftForm.taxRate} aria-label="Tax rate" onChange={e => setDraftForm(c => ({ ...c, taxRate: e.target.value }))} />
        </Field>
        <div className="sm:col-span-2">
          <Field id="draft-description" label="Line item description">
            <Input id="draft-description" value={draftForm.description} aria-label="Line item description" onChange={e => setDraftForm(c => ({ ...c, description: e.target.value }))} />
          </Field>
        </div>
        <Field id="draft-quantity" label="Quantity">
          <Input id="draft-quantity" type="number" min="1" value={draftForm.quantity} aria-label="Quantity" onChange={e => setDraftForm(c => ({ ...c, quantity: e.target.value }))} />
        </Field>
        <Field id="draft-unit-price" label="Unit price">
          <Input id="draft-unit-price" type="number" min="0" step="0.01" value={draftForm.unitPrice} aria-label="Unit price" onChange={e => setDraftForm(c => ({ ...c, unitPrice: e.target.value }))} />
        </Field>
        <div className="sm:col-span-2">
          <Field id="draft-notes" label="Notes">
            <Textarea id="draft-notes" value={draftForm.notes} aria-label="Notes" onChange={e => setDraftForm(c => ({ ...c, notes: e.target.value }))} rows={2} />
          </Field>
        </div>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
        <Button type="button" size="sm" onClick={onSave} loading={Boolean(savingId)}>
          {savingId ? 'Saving…' : 'Save draft'}
        </Button>
      </div>
    </Panel>
  )

  function renderInvoiceRow(inv: Invoice) {
    const tone = INVOICE_STATUS_TONE[inv.status]
    const label = INVOICE_STATUS_LABEL[inv.status] ?? inv.status
    const isEditing = editing?.kind === 'invoices' && editing.id === inv.id
    return (
      <Fragment key={inv.id}>
        <TR>
          <TD><span className="st-num">{inv.invoiceNumber ?? inv.id}</span></TD>
          <TD>{orgMap[inv.orgId ?? ''] ?? inv.orgId ?? '-'}</TD>
          <TD><Status tone={tone}>{label}</Status></TD>
          <TD><span className="st-num">{formatCurrency(inv.total ?? 0, inv.currency ?? 'ZAR')}</span></TD>
          <TD>{formatDate(inv.dueDate)}</TD>
          <TD>
            <div className="flex flex-wrap justify-end gap-2">
              {inv.canEdit ? <Button type="button" variant="ghost" size="sm" onClick={() => startInvoiceEdit(inv)}>Edit</Button> : null}
              {inv.canSend ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => patchInvoice(inv, { status: 'sent' })} disabled={savingId === inv.id}>
                  Mark sent
                </Button>
              ) : null}
              {inv.canCancel ? (
                <Button type="button" variant="danger" size="sm" onClick={() => patchInvoice(inv, { status: 'cancelled' })} disabled={savingId === inv.id}>
                  Cancel
                </Button>
              ) : null}
              <Link href={`/portal/invoicing/${inv.id}`} className="sc-tiny">View</Link>
            </div>
          </TD>
        </TR>
        {isEditing ? (
          <TR>
            <TD colSpan={6}>{renderDraftEditor(() => saveInvoiceDraft(inv))}</TD>
          </TR>
        ) : null}
      </Fragment>
    )
  }

  function renderQuoteRow(quote: Quote) {
    const tone = QUOTE_STATUS_TONE[quote.status]
    const label = QUOTE_STATUS_LABEL[quote.status] ?? quote.status
    const isEditing = editing?.kind === 'quotes' && editing.id === quote.id
    return (
      <Fragment key={quote.id}>
        <TR>
          <TD><span className="st-num">{quote.quoteNumber ?? quote.id}</span></TD>
          <TD>{orgMap[quote.orgId ?? ''] ?? quote.orgId ?? '-'}</TD>
          <TD><Status tone={tone}>{label}</Status></TD>
          <TD><span className="st-num">{formatCurrency(quote.total ?? 0, quote.currency ?? 'ZAR')}</span></TD>
          <TD>{formatDate(quote.validUntil)}</TD>
          <TD>
            <div className="flex flex-wrap justify-end gap-2">
              {quote.canEdit ? <Button type="button" variant="ghost" size="sm" onClick={() => startQuoteEdit(quote)}>Edit</Button> : null}
              {quote.canSend ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => patchQuote(quote, { status: 'sent' })} disabled={savingId === quote.id}>
                  Send
                </Button>
              ) : null}
              {quote.canAccept ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => patchQuote(quote, { status: 'accepted' })} disabled={savingId === quote.id}>
                  Accept
                </Button>
              ) : null}
              {quote.canDecline ? (
                <Button type="button" variant="danger" size="sm" onClick={() => patchQuote(quote, { status: 'declined' })} disabled={savingId === quote.id}>
                  Decline
                </Button>
              ) : null}
            </div>
          </TD>
        </TR>
        {isEditing ? (
          <TR>
            <TD colSpan={6}>{renderDraftEditor(() => saveQuoteDraft(quote))}</TD>
          </TR>
        ) : null}
      </Fragment>
    )
  }

  function renderMobileInvoice(inv: Invoice) {
    const tone = INVOICE_STATUS_TONE[inv.status]
    const label = INVOICE_STATUS_LABEL[inv.status] ?? inv.status
    return (
      <Panel flat key={inv.id} className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="st-num" style={{ color: 'var(--sc-ink)' }}>{inv.invoiceNumber ?? inv.id}</p>
            <p className="sc-body mt-1">{orgMap[inv.orgId ?? ''] ?? inv.orgId ?? '-'}</p>
          </div>
          <Status tone={tone}>{label}</Status>
        </div>
        <p className="st-num">{formatCurrency(inv.total ?? 0, inv.currency ?? 'ZAR')}</p>
        <p className="sc-tiny">Due {formatDate(inv.dueDate)}</p>
        <div className="flex flex-wrap gap-2">
          {inv.canEdit ? <Button type="button" variant="ghost" size="sm" onClick={() => startInvoiceEdit(inv)}>Edit</Button> : null}
          {inv.canSend ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => patchInvoice(inv, { status: 'sent' })} disabled={savingId === inv.id}>
              Mark sent
            </Button>
          ) : null}
          <Link href={`/portal/invoicing/${inv.id}`} className="sc-tiny">View</Link>
        </div>
        {editing?.kind === 'invoices' && editing.id === inv.id ? renderDraftEditor(() => saveInvoiceDraft(inv)) : null}
      </Panel>
    )
  }

  function renderMobileQuote(quote: Quote) {
    const tone = QUOTE_STATUS_TONE[quote.status]
    const label = QUOTE_STATUS_LABEL[quote.status] ?? quote.status
    return (
      <Panel flat key={quote.id} className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="st-num" style={{ color: 'var(--sc-ink)' }}>{quote.quoteNumber ?? quote.id}</p>
            <p className="sc-body mt-1">{orgMap[quote.orgId ?? ''] ?? quote.orgId ?? '-'}</p>
          </div>
          <Status tone={tone}>{label}</Status>
        </div>
        <p className="st-num">{formatCurrency(quote.total ?? 0, quote.currency ?? 'ZAR')}</p>
        <p className="sc-tiny">Valid until {formatDate(quote.validUntil)}</p>
        <div className="flex flex-wrap gap-2">
          {quote.canEdit ? <Button type="button" variant="ghost" size="sm" onClick={() => startQuoteEdit(quote)}>Edit</Button> : null}
          {quote.canSend ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => patchQuote(quote, { status: 'sent' })} disabled={savingId === quote.id}>
              Send
            </Button>
          ) : null}
        </div>
        {editing?.kind === 'quotes' && editing.id === quote.id ? renderDraftEditor(() => saveQuoteDraft(quote)) : null}
      </Panel>
    )
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <PageHeader
        eyebrow="Invoicing"
        title="Billing."
        description={loading ? 'Loading invoices and quotes.' : `${invoices.length} invoices and ${quotes.length} quotes.`}
        actions={
          <ButtonLink href="/portal/invoicing/new" size="sm">
            New invoice
          </ButtonLink>
        }
      />

      {!loading ? (
        <section className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Revenue collected" value={formatCurrency(totalRevenue, 'ZAR')} />
          <StatCard label="Outstanding" value={formatCurrency(outstanding, 'ZAR')} />
          <StatCard label="Overdue" value={String(overdueCount)} />
        </section>
      ) : null}

      <Toolbar>
        <PageTabs
          ariaLabel="Billing tabs"
          tabs={[
            { value: 'invoices', label: `Invoices (${invoices.length})` },
            { value: 'quotes', label: `Quotes (${quotes.length})` },
          ]}
          value={tab}
          onValueChange={(id) => {
            setTab(id as BillingTab)
            setFilter('all')
            setEditing(null)
          }}
        />
        <PageTabs
          ariaLabel="Status filter"
          tabs={filterOptions.map((s) => ({ value: s, label: filterLabel(s) }))}
          value={filter}
          onValueChange={setFilter}
        />
      </Toolbar>

      {loading ? (
        <Panel flat className="space-y-4 p-5">
          <Skeleton height={20} width="12rem" />
          <Skeleton height={20} width="100%" />
          <Skeleton height={20} width="80%" />
        </Panel>
      ) : tab === 'invoices' ? (
        visibleInvoices.length === 0 ? (
          <EmptyState
            title="No invoices found."
            description="Create an invoice to bill a client."
            action={<ButtonLink href="/portal/invoicing/new" variant="secondary" size="sm">Create invoice</ButtonLink>}
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <THead>
                  <TR>
                    <TH>#</TH>
                    <TH>Client</TH>
                    <TH>Status</TH>
                    <TH>Amount</TH>
                    <TH>Date</TH>
                    <TH><span className="sr-only">Actions</span></TH>
                  </TR>
                </THead>
                <tbody>
                  {visibleInvoices.map(renderInvoiceRow)}
                </tbody>
              </Table>
            </div>
            <div className="flex flex-col gap-4 md:hidden">
              {visibleInvoices.map(renderMobileInvoice)}
            </div>
          </>
        )
      ) : visibleQuotes.length === 0 ? (
        <EmptyState
          title="No quotes found."
          description="Create a quote to send pricing to a client."
          action={<ButtonLink href="/portal/invoicing/new" variant="secondary" size="sm">Create invoice</ButtonLink>}
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <THead>
                <TR>
                  <TH>#</TH>
                  <TH>Client</TH>
                  <TH>Status</TH>
                  <TH>Amount</TH>
                  <TH>Date</TH>
                  <TH><span className="sr-only">Actions</span></TH>
                </TR>
              </THead>
              <tbody>
                {visibleQuotes.map(renderQuoteRow)}
              </tbody>
            </Table>
          </div>
          <div className="flex flex-col gap-4 md:hidden">
            {visibleQuotes.map(renderMobileQuote)}
          </div>
        </>
      )}
    </div>
  )
}
