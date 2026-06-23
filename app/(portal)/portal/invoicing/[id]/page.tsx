'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { PaymentInstructions } from '@/lib/invoices/types'
import { INTERVAL_LABELS, RecurrenceInterval } from '@/lib/invoices/recurring'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'payment_pending_verification' | 'paid' | 'partially_paid' | 'overdue' | 'cancelled'

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

type DraftForm = {
  dueDate: string
  taxRate: string
  notes: string
  description: string
  quantity: string
  unitPrice: string
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
  payment_pending_verification: { label: 'Payment review', color: '#facc15' },
  paid:      { label: 'Paid',      color: '#4ade80' },
  partially_paid: { label: 'Partially paid', color: '#34d399' },
  overdue:   { label: 'Overdue',   color: '#ef4444' },
  cancelled: { label: 'Cancelled', color: 'var(--color-outline)' },
}

function formatDate(ts: any) {
  if (!ts) return '—'
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function dateInputValue(value: unknown): string {
  if (!value) return ''
  const candidate = value as { _seconds?: number; seconds?: number }
  const d = candidate._seconds || candidate.seconds
    ? new Date((candidate._seconds ?? candidate.seconds ?? 0) * 1000)
    : new Date(value as string)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function firstLineForm(invoice?: Invoice | null): DraftForm {
  const first = invoice?.lineItems?.[0]
  return {
    dueDate: dateInputValue(invoice?.dueDate),
    taxRate: String(invoice?.taxRate ?? 0),
    notes: invoice?.notes ?? '',
    description: first?.description ?? '',
    quantity: String(first?.quantity ?? 1),
    unitPrice: String(first?.unitPrice ?? 0),
  }
}

function draftPatchFromForm(form: DraftForm) {
  const quantity = Number(form.quantity) || 1
  const unitPrice = Number(form.unitPrice) || 0
  const taxRate = Number(form.taxRate) || 0
  const subtotal = quantity * unitPrice
  const taxAmount = subtotal * (taxRate / 100)
  return {
    dueDate: form.dueDate || null,
    taxRate,
    notes: form.notes,
    lineItems: [{
      description: form.description.trim() || 'Billing item',
      quantity,
      unitPrice,
      amount: subtotal,
    }],
    subtotal,
    taxAmount,
    total: subtotal + taxAmount,
  }
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

export default function InvoiceDetailPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = params.id as string
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [editingDraft, setEditingDraft] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [draftForm, setDraftForm] = useState<DraftForm>(firstLineForm())
  const [duplicating, setDuplicating] = useState(false)
  const [schedule, setSchedule] = useState<{ id: string; status: string; interval: string; nextDueAt: any } | null>(null)
  const [showRecurringForm, setShowRecurringForm] = useState(false)
  const [recurringInterval, setRecurringInterval] = useState<RecurrenceInterval>('monthly')
  const [recurringStartDate, setRecurringStartDate] = useState('')
  const [recurringEndDate, setRecurringEndDate] = useState('')
  const [savingRecurring, setSavingRecurring] = useState(false)
  const [paymentInstructions, setPaymentInstructions] = useState<PaymentInstructions | null>(null)
  const [paymentInstructionsError, setPaymentInstructionsError] = useState<string | null>(null)
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null)
  const [paymentProofNote, setPaymentProofNote] = useState('')
  const [uploadingPaymentProof, setUploadingPaymentProof] = useState(false)
  const [paymentProofMessage, setPaymentProofMessage] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(scopedApiPath(`/api/v1/invoices/${id}`, orgScope)).then(r => r.json()),
      fetch(scopedApiPath('/api/v1/recurring-schedules?status=all', orgScope)).then(r => r.json()),
    ]).then(([invoiceBody, schedulesBody]) => {
      const nextInvoice = invoiceBody.data as Invoice | null
      setInvoice(nextInvoice)
      if (nextInvoice?.canEdit && nextInvoice.status === 'draft' && searchParams.get('edit') === 'draft') {
        setDraftForm(firstLineForm(nextInvoice))
        setEditingDraft(true)
      }
      const match = (schedulesBody.data ?? []).find((s: any) => s.invoiceId === id && s.status !== 'cancelled')
      if (match) setSchedule(match)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [id, orgScope, searchParams])

  useEffect(() => {
    if (!invoice || ['draft', 'paid', 'cancelled'].includes(invoice.status)) {
      setPaymentInstructions(null)
      setPaymentInstructionsError(null)
      return
    }

    let cancelled = false
    fetch(scopedApiPath(`/api/v1/invoices/${id}/payment-instructions`, orgScope))
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load payment instructions')
        return response.json()
      })
      .then((body) => {
        if (cancelled) return
        setPaymentInstructions((body?.data ?? null) as PaymentInstructions | null)
        setPaymentInstructionsError(null)
      })
      .catch(() => {
        if (cancelled) return
        setPaymentInstructions(null)
        setPaymentInstructionsError('Payment instructions are unavailable right now.')
      })

    return () => {
      cancelled = true
    }
  }, [id, invoice, orgScope])

  async function updateStatus(status: InvoiceStatus) {
    if (!invoice) return
    setUpdating(true)
    const res = await fetch(scopedApiPath(`/api/v1/invoices/${id}`, orgScope), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) setInvoice(prev => prev ? { ...prev, status } : prev)
    setUpdating(false)
  }

  function startDraftEdit() {
    setDraftForm(firstLineForm(invoice))
    setEditingDraft(true)
  }

  async function saveDraftInvoice() {
    if (!invoice) return
    const patch = draftPatchFromForm(draftForm)
    setSavingDraft(true)
    const res = await fetch(scopedApiPath(`/api/v1/invoices/${id}`, orgScope), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (res.ok) {
      setInvoice(prev => prev ? { ...prev, ...patch } : prev)
      setEditingDraft(false)
    }
    setSavingDraft(false)
  }

  async function handleDuplicate() {
    setDuplicating(true)
    const res = await fetch(scopedApiPath(`/api/v1/invoices/${id}/duplicate`, orgScope), { method: 'POST' })
    if (res.ok) {
      const body = await res.json()
      router.push(scopedPortalPath(`/portal/invoicing/${body.data.id}`, orgScope))
    } else {
      setDuplicating(false)
    }
  }

  function handlePrint() {
    window.print()
  }

  async function handleUploadPaymentProof() {
    if (!invoice || !paymentProofFile) return

    setUploadingPaymentProof(true)
    setPaymentProofMessage(null)

    try {
      const formData = new FormData()
      formData.append('file', paymentProofFile)
      formData.append('note', paymentProofNote)

      const uploadResponse = await fetch(
        scopedApiPath(`/api/v1/portal/invoices/${id}/payment-proof-upload`, orgScope),
        {
          method: 'POST',
          body: formData,
        },
      )
      const uploadBody = await uploadResponse.json().catch(() => ({}))
      if (!uploadResponse.ok) {
        throw new Error(uploadBody?.error ?? 'Failed to upload payment proof')
      }

      const proofResponse = await fetch(
        scopedApiPath(`/api/v1/invoices/${id}/payment-proof`, orgScope),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileId: uploadBody?.data?.id,
            note: paymentProofNote,
          }),
        },
      )
      const proofBody = await proofResponse.json().catch(() => ({}))
      if (!proofResponse.ok) {
        throw new Error(proofBody?.error ?? 'Failed to submit payment proof')
      }

      setInvoice((current) => current ? { ...current, status: 'payment_pending_verification' } : current)
      setPaymentProofFile(null)
      setPaymentProofNote('')
      setPaymentProofMessage(null)
    } catch (error) {
      setPaymentProofMessage(error instanceof Error ? error.message : 'Failed to submit payment proof')
    } finally {
      setUploadingPaymentProof(false)
    }
  }

  async function handleCreateRecurring() {
    if (!recurringStartDate) return
    setSavingRecurring(true)
    const res = await fetch(scopedApiPath(`/api/v1/invoices/${id}/recurring`, orgScope), {
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
    const res = await fetch(scopedApiPath(`/api/v1/invoices/${id}/recurring`, orgScope), { method: 'DELETE' })
    if (res.ok) setSchedule(null)
    setSavingRecurring(false)
  }

  if (loading) return <div className="space-y-4"><Skeleton className="h-12 w-64" /><Skeleton className="h-96" /></div>
  if (!invoice) return <div className="pib-card py-12 text-center"><p className="text-on-surface-variant">Invoice not found.</p></div>

  const status = STATUS_MAP[invoice.status]
  const taxLabel = invoice.currency === 'ZAR' ? 'VAT' : 'Tax'
  const canShowPaymentWorkspace = !['draft', 'paid', 'cancelled'].includes(invoice.status)

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Link href={scopedPortalPath('/portal/invoicing', orgScope)} className="text-xs text-on-surface-variant hover:text-on-surface transition-colors">← Invoicing</Link>
          <h1 className="text-2xl font-headline font-bold text-on-surface mt-1">{invoice.invoiceNumber}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-label uppercase tracking-wide px-2 py-1 rounded-full" style={{ background: `${status.color}20`, color: status.color }}>
            {status.label}
          </span>
          <a
            href={scopedApiPath(`/api/v1/invoices/${id}/pdf`, orgScope)}
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
                <span>{taxLabel} ({invoice.taxRate}%)</span><span>{formatCurrencyValue(invoice.taxAmount ?? 0, invoice.currency)}</span>
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

      {canShowPaymentWorkspace && (
        <div className="pib-card space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-on-surface">EFT payment</p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Use the invoice number as the EFT reference, then upload proof so finance can verify it.
              </p>
            </div>
            {paymentInstructions?.publicViewUrl ? (
              <a
                href={paymentInstructions.publicViewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="pib-btn-secondary text-xs font-label"
              >
                Open public invoice
              </a>
            ) : null}
          </div>

          {paymentInstructionsError ? (
            <p className="text-sm text-red-300">{paymentInstructionsError}</p>
          ) : paymentInstructions ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[var(--radius-card)] border border-[var(--color-card-border)] bg-white/[0.02] p-4">
                <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant">Bank details</p>
                <dl className="mt-3 space-y-2 text-sm text-on-surface">
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-on-surface-variant">Bank</dt>
                    <dd>{paymentInstructions.eft.bankingDetails.bankName ?? '—'}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-on-surface-variant">Account name</dt>
                    <dd>{paymentInstructions.eft.bankingDetails.accountName ?? '—'}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-on-surface-variant">Account number</dt>
                    <dd>{paymentInstructions.eft.bankingDetails.accountNumber ?? '—'}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-on-surface-variant">Branch code</dt>
                    <dd>{paymentInstructions.eft.bankingDetails.branchCode ?? '—'}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-on-surface-variant">Reference</dt>
                    <dd>{paymentInstructions.eft.reference}</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-[var(--radius-card)] border border-[var(--color-card-border)] bg-white/[0.02] p-4 space-y-3">
                <div>
                  <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant">Proof upload</p>
                  <p className="mt-2 text-sm text-on-surface-variant">
                    Send proof to {paymentInstructions.eft.proofOfPaymentEmail} or attach it here for verification.
                  </p>
                </div>

                {invoice.status === 'payment_pending_verification' ? (
                  <p className="rounded-[var(--radius-card)] border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                    Payment proof submitted. Finance is reviewing it now.
                  </p>
                ) : null}

                <label className="block text-xs text-on-surface-variant">
                  Upload payment proof
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    aria-label="Upload payment proof"
                    onChange={(event) => setPaymentProofFile(event.target.files?.[0] ?? null)}
                    className="pib-input mt-1 w-full"
                  />
                </label>

                <label className="block text-xs text-on-surface-variant">
                  Payment note
                  <textarea
                    aria-label="Payment note"
                    value={paymentProofNote}
                    onChange={(event) => setPaymentProofNote(event.target.value)}
                    className="pib-textarea mt-1 w-full"
                    rows={3}
                    placeholder="Add a payment reference, sending account, or anything finance should verify."
                  />
                </label>

                <button
                  type="button"
                  onClick={handleUploadPaymentProof}
                  disabled={!paymentProofFile || uploadingPaymentProof}
                  className="pib-btn-primary text-sm font-label disabled:opacity-60"
                >
                  {uploadingPaymentProof ? 'Submitting proof…' : 'Submit proof of payment'}
                </button>

                {paymentProofMessage ? (
                  <p className="text-sm text-on-surface">{paymentProofMessage}</p>
                ) : null}
              </div>
            </div>
          ) : (
            <Skeleton className="h-48" />
          )}
        </div>
      )}

      {/* Actions */}
      {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
        <div className="flex flex-wrap gap-2 justify-end">
          {invoice.canEdit && invoice.status === 'draft' && (
            <button onClick={startDraftEdit} className="pib-btn-secondary text-xs font-label">
              Edit draft invoice
            </button>
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

      {editingDraft && invoice.canEdit && invoice.status === 'draft' && (
        <div className="pib-card space-y-4">
          <div>
            <p className="text-sm font-medium text-on-surface">Draft invoice editor</p>
            <p className="text-xs text-on-surface-variant mt-0.5">Update the editable draft fields before sending this invoice.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-on-surface-variant">Due date
              <input
                type="date"
                value={draftForm.dueDate}
                onChange={(event) => setDraftForm((current) => ({ ...current, dueDate: event.target.value }))}
                className="pib-input mt-1 w-full"
              />
            </label>
            <label className="text-xs text-on-surface-variant">Tax rate
              <input
                type="number"
                min="0"
                max="100"
                value={draftForm.taxRate}
                onChange={(event) => setDraftForm((current) => ({ ...current, taxRate: event.target.value }))}
                className="pib-input mt-1 w-full"
              />
            </label>
            <label className="text-xs text-on-surface-variant sm:col-span-2">Line item description
              <input
                value={draftForm.description}
                onChange={(event) => setDraftForm((current) => ({ ...current, description: event.target.value }))}
                className="pib-input mt-1 w-full"
              />
            </label>
            <label className="text-xs text-on-surface-variant">Quantity
              <input
                type="number"
                min="1"
                value={draftForm.quantity}
                onChange={(event) => setDraftForm((current) => ({ ...current, quantity: event.target.value }))}
                className="pib-input mt-1 w-full"
              />
            </label>
            <label className="text-xs text-on-surface-variant">Unit price
              <input
                type="number"
                min="0"
                step="0.01"
                value={draftForm.unitPrice}
                onChange={(event) => setDraftForm((current) => ({ ...current, unitPrice: event.target.value }))}
                className="pib-input mt-1 w-full"
              />
            </label>
            <label className="text-xs text-on-surface-variant sm:col-span-2">Notes
              <textarea
                value={draftForm.notes}
                onChange={(event) => setDraftForm((current) => ({ ...current, notes: event.target.value }))}
                className="pib-textarea mt-1 w-full"
                rows={2}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditingDraft(false)} className="pib-btn-secondary text-sm font-label">
              Cancel
            </button>
            <button type="button" onClick={saveDraftInvoice} disabled={savingDraft} className="pib-btn-primary text-sm font-label disabled:opacity-60">
              {savingDraft ? 'Saving...' : 'Save draft invoice'}
            </button>
          </div>
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
