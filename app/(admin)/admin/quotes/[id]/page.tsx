'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'converted'

interface Quote {
  id: string
  quoteNumber: string
  orgId: string
  status: QuoteStatus
  total: number
  subtotal: number
  taxRate: number
  taxAmount: number
  currency: string
  lineItems: { description: string; quantity: number; unitPrice: number; amount: number }[]
  notes?: string
  issueDate?: DateLike
  validUntil?: DateLike
  clientDetails?: { name: string }
  convertedInvoiceId?: string
}

type DateLike = string | number | Date | { _seconds?: number; seconds?: number } | null | undefined

const STATUS_MAP: Record<QuoteStatus, { label: string; color: string }> = {
  draft:     { label: 'Draft',     color: 'var(--color-outline)' },
  sent:      { label: 'Sent',      color: '#60a5fa' },
  accepted:  { label: 'Accepted',  color: '#4ade80' },
  declined:  { label: 'Declined',  color: '#ef4444' },
  expired:   { label: 'Expired',   color: 'var(--color-outline)' },
  converted: { label: 'Converted', color: '#c084fc' },
}

const CURRENCY_LOCALES: Record<string, string> = { USD: 'en-US', EUR: 'de-DE', ZAR: 'en-ZA' }

function fmtCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat(CURRENCY_LOCALES[currency] || 'en-US', {
    style: 'currency', currency: currency || 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}

function formatDate(ts: DateLike) {
  if (!ts) return '—'
  const seconds = isRecord(ts) && typeof ts._seconds === 'number'
    ? ts._seconds
    : isRecord(ts) && typeof ts.seconds === 'number'
      ? ts.seconds
      : null
  const d = seconds ? new Date(seconds * 1000) : new Date(ts as string | number | Date)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function extractQuote(body: unknown): Quote | null {
  const data = isRecord(body) ? body.data : undefined
  if (isRecord(data) && data.quote) return data.quote as unknown as Quote
  if (isRecord(data) && (data.id || data.quoteNumber)) return data as unknown as Quote
  return null
}

export default function QuoteDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [converting, setConverting] = useState(false)

  useEffect(() => {
    fetch(`/api/v1/quotes/${id}`)
      .then(r => r.json())
      .then(body => { setQuote(extractQuote(body)); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  async function updateStatus(status: QuoteStatus) {
    if (!quote) return
    setUpdating(true)
    const res = await fetch(`/api/v1/quotes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) setQuote(prev => prev ? { ...prev, status } : prev)
    setUpdating(false)
  }

  async function convertToInvoice() {
    if (!quote) return
    setConverting(true)
    const res = await fetch(`/api/v1/quotes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'convert-to-invoice' }),
    })
    if (res.ok) {
      const body = await res.json()
      router.push(`/admin/invoicing/${body.data.invoiceId}`)
    }
    setConverting(false)
  }

  if (loading) return <div className="space-y-4"><div className="pib-skeleton h-12 w-64" /><div className="pib-skeleton h-96" /></div>
  if (!quote) return <div className="pib-card py-12 text-center"><p className="text-on-surface-variant">Quote not found.</p></div>

  const status = STATUS_MAP[quote.status]

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Link href="/admin/quotes" className="text-xs text-on-surface-variant hover:text-on-surface transition-colors">← Quotes</Link>
          <h1 className="text-2xl font-headline font-bold text-on-surface mt-1">{quote.quoteNumber}</h1>
        </div>
        <span className="text-[10px] font-label uppercase tracking-wide px-2 py-1 rounded-full self-start sm:self-auto" style={{ background: `${status.color}20`, color: status.color }}>
          {status.label}
        </span>
      </div>

      {/* Quote card */}
      <div className="pib-card space-y-6">
        <div className="flex flex-col sm:flex-row sm:justify-between gap-3">
          <div>
            <p className="text-lg font-headline font-bold text-on-surface">Partners in Biz</p>
            <p className="text-sm text-on-surface-variant">partnersinbiz.online</p>
          </div>
          <div className="sm:text-right">
            <p className="text-2xl font-headline font-bold" style={{ color: 'var(--color-accent-v2)' }}>{quote.quoteNumber}</p>
            <p className="text-xs text-on-surface-variant mt-1">Issued: {formatDate(quote.issueDate)}</p>
            <p className="text-xs text-on-surface-variant">Valid Until: {formatDate(quote.validUntil)}</p>
          </div>
        </div>

        <div className="border-t border-[var(--color-card-border)] pt-4">
          <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Quote For</p>
          <p className="text-sm font-medium text-on-surface">{quote.clientDetails?.name ?? quote.orgId}</p>
        </div>

        {/* Line items */}
        <div>
          <div className="hidden sm:grid grid-cols-12 gap-2 pb-2 border-b border-[var(--color-card-border)]">
            <p className="col-span-6 text-[9px] font-label uppercase tracking-widest text-on-surface-variant">Description</p>
            <p className="col-span-2 text-right text-[9px] font-label uppercase tracking-widest text-on-surface-variant">Qty</p>
            <p className="col-span-2 text-right text-[9px] font-label uppercase tracking-widest text-on-surface-variant">Unit</p>
            <p className="col-span-2 text-right text-[9px] font-label uppercase tracking-widest text-on-surface-variant">Amount</p>
          </div>
          {quote.lineItems.map((item, i) => (
            <div key={i} className="py-3 border-b border-[var(--color-card-border)]/50 sm:grid sm:grid-cols-12 sm:gap-2 sm:py-2">
              <p className="text-sm text-on-surface sm:col-span-6 mb-2 sm:mb-0">{item.description}</p>
              <div className="flex justify-between sm:contents text-sm text-on-surface-variant">
                <span className="sm:col-span-2 sm:text-right"><span className="sm:hidden text-[9px] font-label uppercase tracking-widest mr-1">Qty</span>{item.quantity}</span>
                <span className="sm:col-span-2 sm:text-right"><span className="sm:hidden text-[9px] font-label uppercase tracking-widest mr-1">Unit</span>{fmtCurrency(item.unitPrice, quote.currency)}</span>
                <span className="sm:col-span-2 sm:text-right text-on-surface font-medium"><span className="sm:hidden text-[9px] font-label uppercase tracking-widest mr-1 text-on-surface-variant">Amount</span>{fmtCurrency(item.amount, quote.currency)}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="space-y-1 min-w-48">
            <div className="flex justify-between text-sm text-on-surface-variant">
              <span>Subtotal</span><span>{fmtCurrency(quote.subtotal ?? 0, quote.currency)}</span>
            </div>
            {quote.taxRate > 0 && (
              <div className="flex justify-between text-sm text-on-surface-variant">
                <span>Tax ({quote.taxRate}%)</span><span>{fmtCurrency(quote.taxAmount ?? 0, quote.currency)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold text-on-surface pt-1 border-t border-[var(--color-card-border)]">
              <span>Total</span>
              <span style={{ color: 'var(--color-accent-v2)' }}>{fmtCurrency(quote.total ?? 0, quote.currency)}</span>
            </div>
          </div>
        </div>

        {quote.notes && (
          <div className="border-t border-[var(--color-card-border)] pt-4">
            <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Notes</p>
            <p className="text-sm text-on-surface-variant">{quote.notes}</p>
          </div>
        )}
      </div>

      {/* Converted banner */}
      {quote.status === 'converted' && quote.convertedInvoiceId && (
        <div className="pib-card bg-purple-500/10 border-purple-500/20">
          <p className="text-sm text-on-surface">
            This quote was converted to an invoice.{' '}
            <Link href={`/admin/invoicing/${quote.convertedInvoiceId}`} style={{ color: 'var(--color-accent-v2)' }}>
              View Invoice →
            </Link>
          </p>
        </div>
      )}

      {/* Actions */}
      {!['converted', 'declined', 'expired'].includes(quote.status) && (
        <div className="flex gap-2 flex-wrap">
          {quote.status === 'draft' && (
            <button onClick={() => updateStatus('sent')} disabled={updating} className="pib-btn-primary font-label">
              Mark as Sent
            </button>
          )}
          {quote.status === 'sent' && (
            <>
              <button onClick={() => updateStatus('accepted')} disabled={updating} className="pib-btn-primary font-label">
                Mark as Accepted
              </button>
              <button onClick={() => updateStatus('declined')} disabled={updating} className="pib-btn-secondary font-label text-sm">
                Mark as Declined
              </button>
            </>
          )}
          {quote.status === 'accepted' && !quote.convertedInvoiceId && (
            <button onClick={convertToInvoice} disabled={converting} className="pib-btn-primary font-label">
              {converting ? 'Converting…' : 'Convert to Invoice'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
