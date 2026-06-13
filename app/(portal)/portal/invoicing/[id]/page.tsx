'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { INTERVAL_LABELS, RecurrenceInterval } from '@/lib/invoices/recurring'

type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'paid' | 'overdue' | 'cancelled'

interface Invoice {
  id: string
  invoiceNumber: string
  orgId: string
  status: InvoiceStatus
  total: number
  subtotal: number
  taxRate: number
  taxAmount: number
  currency: string
  lineItems: { description: string; quantity: number; unitPrice: number; amount: number }[]
  notes?: string
  issueDate?: any
  dueDate?: any
  paidAt?: any
  sentAt?: any
  canEdit?: boolean
  canSend?: boolean
  canCancel?: boolean
  canMarkPaid?: boolean
}

const CURRENCY_LOCALES: Record<string, string> = { USD: 'en-US', EUR: 'de-DE', ZAR: 'en-ZA' }

function formatCurrencyValue(amount: number, currency: string): string {
  return new Intl.NumberFormat(CURRENCY_LOCALES[currency] || 'en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

const STATUS_MAP: Record<InvoiceStatus, { label: string; color: string }> = {
  draft:     { label: 'Draft',     color: 'var(--color-outline)' },
  sent:      { label: 'Sent',      color: '#60a5fa' },
  viewed:    { label: 'Viewed',    color: '#c084fc' },
  paid:      { label: 'Paid',      color: '#4ade80' },
  overdue:   { label: 'Overdue',   color: '#ef4444' },
  cancelled: { label: 'Cancelled', color: 'var(--color-outline)' },
}

function formatDate(ts: any) {
  if (!ts) return '—'
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

export default function InvoiceDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [schedule, setSchedule] = useState<{ id: string; status: string; interval: string; nextDueAt: any } | null>(null)
  const [showRecurringForm, setShowRecurringForm] = useState(false)
  const [recurringInterval, setRecurringInterval] = useState<RecurrenceInterval>('monthly')
  const [recurringStartDate, setRecurringStartDate] = useState('')
  const [recurringEndDate, setRecurringEndDate] = useState('')
  const [savingRecurring, setSavingRecurring] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`/api/v1/invoices/${id}`).then(r => r.json()),
      fetch(`/api/v1/recurring-schedules?status=all`).then(r => r.json()),
    ]).then(([invoiceBody, schedulesBody]) => {
      setInvoice(invoiceBody.data)
      const match = (schedulesBody.data ?? []).find((s: any) => s.invoiceId === id && s.status !== 'cancelled')
      if (match) setSchedule(match)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [id])

  async function updateStatus(status: InvoiceStatus) {
    if (!invoice) return
    setUpdating(true)
    const res = await fetch(`/api/v1/invoices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) setInvoice(prev => prev ? { ...prev, status } : prev)
    setUpdating(false)
  }

  async function handleDuplicate() {
    setDuplicating(true)
    const res = await fetch(`/api/v1/invoices/${id}/duplicate`, { method: 'POST' })
    if (res.ok) {
      const body = await res.json()
      router.push(`/portal/invoicing/${body.data.id}`)
    } else {
      setDuplicating(false)
    }
  }

  function handlePrint() {
    window.print()
  }

  async function handleCreateRecurring() {
    if (!recurringStartDate) return
    setSavingRecurring(true)
    const res = await fetch(`/api/v1/invoices/${id}/recurring`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        interval: recurringInterval,
        startDate: recurringStartDate,
        endDate: recurringEndDate || undefined,
      }),
    })
    if (res.ok) {
      const body = await res.json()
      setSchedule({ id: body.data.id, status: 'active', interval: recurringInterval, nextDueAt: null })
      setShowRecurringForm(false)
    }
    setSavingRecurring(false)
  }

  async function handleCancelRecurring() {
    if (!schedule) return
    setSavingRecurring(true)
    const res = await fetch(`/api/v1/invoices/${id}/recurring`, { method: 'DELETE' })
    if (res.ok) setSchedule(null)
    setSavingRecurring(false)
  }

  if (loading) return <div className="space-y-4"><Skeleton className="h-12 w-64" /><Skeleton className="h-96" /></div>
  if (!invoice) return <div className="pib-card py-12 text-center"><p className="text-on-surface-variant">Invoice not found.</p></div>

  const status = STATUS_MAP[invoice.status]

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Link href="/portal/invoicing" className="text-xs text-on-surface-variant hover:text-on-surface transition-colors">← Invoicing</Link>
          <h1 className="text-2xl font-headline font-bold text-on-surface mt-1">{invoice.invoiceNumber}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-label uppercase tracking-wide px-2 py-1 rounded-full" style={{ background: `${status.color}20`, color: status.color }}>
            {status.label}
          </span>
          <a
            href={`/api/v1/invoices/${id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="pib-btn-secondary text-sm font-label"
          >
            📄 Download PDF
          </a>
          <button
            onClick={handleDuplicate}
            disabled={duplicating}
            className="pib-btn-secondary text-sm font-label"
          >
            {duplicating ? 'Duplicating…' : 'Duplicate'}
          </button>
          <button onClick={handlePrint} className="pib-btn-secondary text-sm font-label">Print</button>
        </div>
      </div>

      {/* Invoice card */}
      <div className="pib-card space-y-6" id="invoice-print">
        {/* Top meta */}
        <div className="flex flex-col sm:flex-row sm:justify-between gap-3">
          <div>
            <p className="text-lg font-headline font-bold text-on-surface">Partners in Biz</p>
            <p className="text-sm text-on-surface-variant">partnersinbiz.online</p>
          </div>
          <div className="sm:text-right">
            <p className="text-2xl font-headline font-bold" style={{ color: 'var(--color-accent-v2)' }}>{invoice.invoiceNumber}</p>
            <p className="text-xs text-on-surface-variant mt-1">Issued: {formatDate(invoice.issueDate)}</p>
            <p className="text-xs text-on-surface-variant">Due: {formatDate(invoice.dueDate)}</p>
          </div>
        </div>

        <div className="border-t border-[var(--color-card-border)] pt-4">
          <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Bill To</p>
          <p className="text-sm font-medium text-on-surface">{(invoice as any).clientDetails?.name ?? invoice.orgId}</p>
        </div>

        {/* Line items */}
        <div>
          <div className="hidden sm:grid grid-cols-12 gap-2 pb-2 border-b border-[var(--color-card-border)]">
            <p className="col-span-6 text-[9px] font-label uppercase tracking-widest text-on-surface-variant">Description</p>
            <p className="col-span-2 text-right text-[9px] font-label uppercase tracking-widest text-on-surface-variant">Qty</p>
            <p className="col-span-2 text-right text-[9px] font-label uppercase tracking-widest text-on-surface-variant">Unit</p>
            <p className="col-span-2 text-right text-[9px] font-label uppercase tracking-widest text-on-surface-variant">Amount</p>
          </div>
          {invoice.lineItems.map((item, i) => (
            <div key={i} className="py-3 border-b border-[var(--color-card-border)]/50 sm:grid sm:grid-cols-12 sm:gap-2 sm:py-2">
              <p className="text-sm text-on-surface sm:col-span-6 mb-2 sm:mb-0">{item.description}</p>
              <div className="flex justify-between sm:contents text-sm text-on-surface-variant">
                <span className="sm:col-span-2 sm:text-right"><span className="sm:hidden text-[9px] font-label uppercase tracking-widest mr-1">Qty</span>{item.quantity}</span>
                <span className="sm:col-span-2 sm:text-right"><span className="sm:hidden text-[9px] font-label uppercase tracking-widest mr-1">Unit</span>{formatCurrencyValue(item.unitPrice, invoice.currency)}</span>
                <span className="sm:col-span-2 sm:text-right text-on-surface font-medium"><span className="sm:hidden text-[9px] font-label uppercase tracking-widest mr-1 text-on-surface-variant">Amount</span>{formatCurrencyValue(item.amount, invoice.currency)}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="space-y-1 min-w-48">
            <div className="flex justify-between text-sm text-on-surface-variant">
              <span>Subtotal</span><span>{formatCurrencyValue(invoice.subtotal ?? 0, invoice.currency)}</span>
            </div>
            {invoice.taxRate > 0 && (
              <div className="flex justify-between text-sm text-on-surface-variant">
                <span>Tax ({invoice.taxRate}%)</span><span>{formatCurrencyValue(invoice.taxAmount ?? 0, invoice.currency)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold text-on-surface pt-1 border-t border-[var(--color-card-border)]">
              <span>Total</span>
              <span style={{ color: 'var(--color-accent-v2)' }}>{formatCurrencyValue(invoice.total ?? 0, invoice.currency)}</span>
            </div>
          </div>
        </div>

        {invoice.notes && (
          <div className="border-t border-[var(--color-card-border)] pt-4">
            <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Notes</p>
            <p className="text-sm text-on-surface-variant">{invoice.notes}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
        <div className="flex flex-wrap gap-2 justify-end">
          {invoice.canEdit && invoice.status === 'draft' && (
            <Link href="/portal/invoicing" className="pib-btn-secondary text-xs font-label">
              Edit Draft
            </Link>
          )}
          {invoice.canSend && invoice.status === 'draft' && (
            <button onClick={() => updateStatus('sent')} disabled={updating} className="pib-btn-primary text-xs font-label disabled:opacity-50">
              {updating ? 'Updating…' : 'Mark Sent'}
            </button>
          )}
          {invoice.canCancel && (
            <button onClick={() => updateStatus('cancelled')} disabled={updating} className="pib-btn-secondary text-xs font-label disabled:opacity-50">
              {updating ? 'Updating…' : 'Cancel Invoice'}
            </button>
          )}
        </div>
      )}

      {/* Recurring */}
      <div className="pib-card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-on-surface">Recurring Invoice</p>
            {schedule ? (
              <p className="text-xs text-on-surface-variant mt-0.5">
                {INTERVAL_LABELS[schedule.interval as RecurrenceInterval] ?? schedule.interval} · Status: {schedule.status}
              </p>
            ) : (
              <p className="text-xs text-on-surface-variant mt-0.5">Not set up</p>
            )}
          </div>
          {schedule ? (
            <button
              onClick={handleCancelRecurring}
              disabled={savingRecurring}
              className="pib-btn-secondary text-sm font-label"
            >
              Cancel Recurring
            </button>
          ) : (
            <button
              onClick={() => setShowRecurringForm(v => !v)}
              className="pib-btn-secondary text-sm font-label"
            >
              Set Up Recurring
            </button>
          )}
        </div>

        {showRecurringForm && !schedule && (
          <div className="space-y-3 border-t border-[var(--color-card-border)] pt-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant block mb-1">Interval</label>
                <select
                  value={recurringInterval}
                  onChange={e => setRecurringInterval(e.target.value as RecurrenceInterval)}
                  className="pib-input w-full text-sm"
                >
                  {(Object.keys(INTERVAL_LABELS) as RecurrenceInterval[]).map(k => (
                    <option key={k} value={k}>{INTERVAL_LABELS[k]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant block mb-1">Start Date</label>
                <input
                  type="date"
                  value={recurringStartDate}
                  onChange={e => setRecurringStartDate(e.target.value)}
                  className="pib-input w-full text-sm"
                />
              </div>
              <div>
                <label className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant block mb-1">End Date (optional)</label>
                <input
                  type="date"
                  value={recurringEndDate}
                  onChange={e => setRecurringEndDate(e.target.value)}
                  className="pib-input w-full text-sm"
                />
              </div>
            </div>
            <button
              onClick={handleCreateRecurring}
              disabled={savingRecurring || !recurringStartDate}
              className="pib-btn-primary font-label text-sm"
            >
              {savingRecurring ? 'Saving…' : 'Save Recurring Schedule'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
