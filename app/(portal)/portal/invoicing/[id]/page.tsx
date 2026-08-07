'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { PaymentInstructions } from '@/lib/invoices/types'
import { INTERVAL_LABELS, RecurrenceInterval } from '@/lib/invoices/recurring'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import { ShareWithPartnerButton } from '@/components/crm/ShareWithPartnerButton'

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

const STATUS_MAP: Record<InvoiceStatus, { label: string; pill: string }> = {
  draft:     { label: 'Draft',     pill: 'pib-pill' },
  sent:      { label: 'Sent',      pill: 'pib-pill pib-pill-blue' },
  viewed:    { label: 'Viewed',    pill: 'pib-pill pib-pill-violet' },
  payment_pending_verification: { label: 'Payment review', pill: 'pib-pill pib-pill-warn' },
  paid:      { label: 'Paid',      pill: 'pib-pill pib-pill-success' },
  partially_paid: { label: 'Partially paid', pill: 'pib-pill pib-pill-success' },
  overdue:   { label: 'Overdue',   pill: 'pib-pill pib-pill-danger' },
  cancelled: { label: 'Cancelled', pill: 'pib-pill' },
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
  if (!invoice) return (
    <div className="pib-empty-state">
      <span aria-hidden="true" className="material-symbols-outlined pib-empty-state-icon">receipt_long</span>
      <h2 className="pib-empty-state-title">Invoice not found.</h2>
    </div>
  )

  const status = STATUS_MAP[invoice.status]
  const taxLabel = invoice.currency === 'ZAR' ? 'VAT' : 'Tax'
  const canShowPaymentWorkspace = !['draft', 'paid', 'cancelled'].includes(invoice.status)

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href={scopedPortalPath('/portal/invoicing', orgScope)} className="text-xs text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)]">← Invoicing</Link>
          <p className="eyebrow mt-3">Invoicing · Invoice</p>
          <h1 className="pib-page-title mt-2">{invoice.invoiceNumber}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={status.pill}>
            {status.label}
          </span>
          <a
            href={scopedApiPath(`/api/v1/invoices/${id}/pdf`, orgScope)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-pib-secondary"
          >
            📄 Download PDF
          </a>
          <button
            onClick={handleDuplicate}
            disabled={duplicating}
            className="btn-pib-secondary"
          >
            {duplicating ? 'Duplicating…' : 'Duplicate'}
          </button>
          <button onClick={handlePrint} className="btn-pib-secondary">Print</button>
          <ShareWithPartnerButton resourceType="invoice" resourceId={id} />
        </div>
      </header>

      {/* Invoice card */}
      <div className="pib-card space-y-6" id="invoice-print">
        {/* Top meta */}
        <div className="flex flex-col sm:flex-row sm:justify-between gap-3">
          <div>
            <p className="text-lg font-semibold">Partners in Biz</p>
            <p className="text-sm text-[var(--color-pib-text-muted)]">partnersinbiz.online</p>
          </div>
          <div className="sm:text-right">
            <p className="text-2xl font-semibold text-[var(--color-pib-accent)]">{invoice.invoiceNumber}</p>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Issued: {formatDate(invoice.issueDate)}</p>
            <p className="text-xs text-[var(--color-pib-text-muted)]">Due: {formatDate(invoice.dueDate)}</p>
          </div>
        </div>

        <div className="border-t border-[var(--color-pib-line)] pt-4">
          <p className="pib-label mb-1">Bill To</p>
          <p className="text-sm font-medium">{(invoice as any).clientDetails?.name ?? invoice.orgId}</p>
        </div>

        {/* Line items */}
        <div>
          <div className="hidden sm:grid grid-cols-12 gap-2 pb-2 border-b border-[var(--color-pib-line)]">
            <p className="col-span-6 pib-label">Description</p>
            <p className="col-span-2 pib-label text-right">Qty</p>
            <p className="col-span-2 pib-label text-right">Unit</p>
            <p className="col-span-2 pib-label text-right">Amount</p>
          </div>
          {invoice.lineItems.map((item, i) => (
            <div key={i} className="border-b border-[var(--color-pib-line)] py-3 sm:grid sm:grid-cols-12 sm:gap-2 sm:py-2">
              <p className="mb-2 text-sm sm:col-span-6 sm:mb-0">{item.description}</p>
              <div className="flex justify-between text-sm text-[var(--color-pib-text-muted)] sm:contents">
                <span className="sm:col-span-2 sm:text-right"><span className="pib-label mr-1 sm:hidden">Qty</span>{item.quantity}</span>
                <span className="sm:col-span-2 sm:text-right"><span className="pib-label mr-1 sm:hidden">Unit</span>{formatCurrencyValue(item.unitPrice, invoice.currency)}</span>
                <span className="font-medium text-[var(--color-pib-text)] sm:col-span-2 sm:text-right"><span className="pib-label mr-1 sm:hidden">Amount</span>{formatCurrencyValue(item.amount, invoice.currency)}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="min-w-48 space-y-1">
            <div className="flex justify-between text-sm text-[var(--color-pib-text-muted)]">
              <span>Subtotal</span><span>{formatCurrencyValue(invoice.subtotal ?? 0, invoice.currency)}</span>
            </div>
            {invoice.taxRate > 0 && (
              <div className="flex justify-between text-sm text-[var(--color-pib-text-muted)]">
                <span>{taxLabel} ({invoice.taxRate}%)</span><span>{formatCurrencyValue(invoice.taxAmount ?? 0, invoice.currency)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-[var(--color-pib-line)] pt-1 text-base font-semibold">
              <span>Total</span>
              <span className="text-[var(--color-pib-accent)]">{formatCurrencyValue(invoice.total ?? 0, invoice.currency)}</span>
            </div>
          </div>
        </div>

        {invoice.notes && (
          <div className="border-t border-[var(--color-pib-line)] pt-4">
            <p className="pib-label mb-1">Notes</p>
            <p className="text-sm text-[var(--color-pib-text-muted)]">{invoice.notes}</p>
          </div>
        )}
      </div>

      {canShowPaymentWorkspace && (
        <div className="pib-card space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="pib-icon-tint pib-icon-tint-cyan" aria-hidden="true">
                <span className="material-symbols-outlined text-[18px]">account_balance</span>
              </span>
              <div>
                <p className="text-sm font-medium">EFT payment</p>
                <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">
                  Use the invoice number as the EFT reference, then upload proof so finance can verify it.
                </p>
              </div>
            </div>
            {paymentInstructions?.publicViewUrl ? (
              <a
                href={paymentInstructions.publicViewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-pib-secondary"
              >
                Open public invoice
              </a>
            ) : null}
          </div>

          {paymentInstructionsError ? (
            <p className="text-sm text-[var(--color-error)]">{paymentInstructionsError}</p>
          ) : paymentInstructions ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-[var(--color-pib-line)] p-4">
                <p className="pib-label">Bank details</p>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-[var(--color-pib-text-muted)]">Bank</dt>
                    <dd>{paymentInstructions.eft.bankingDetails.bankName ?? '—'}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-[var(--color-pib-text-muted)]">Account name</dt>
                    <dd>{paymentInstructions.eft.bankingDetails.accountName ?? '—'}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-[var(--color-pib-text-muted)]">Account number</dt>
                    <dd>{paymentInstructions.eft.bankingDetails.accountNumber ?? '—'}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-[var(--color-pib-text-muted)]">Branch code</dt>
                    <dd>{paymentInstructions.eft.bankingDetails.branchCode ?? '—'}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-[var(--color-pib-text-muted)]">Reference</dt>
                    <dd>{paymentInstructions.eft.reference}</dd>
                  </div>
                </dl>
              </div>

              <div className="space-y-3 rounded-2xl border border-[var(--color-pib-line)] p-4">
                <div>
                  <p className="pib-label">Proof upload</p>
                  <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
                    Send proof to {paymentInstructions.eft.proofOfPaymentEmail} or attach it here for verification.
                  </p>
                </div>

                {invoice.status === 'payment_pending_verification' ? (
                  <p className="pib-pill pib-pill-warn">
                    Payment proof submitted. Finance is reviewing it now.
                  </p>
                ) : null}

                <label className="pib-label block">
                  Upload payment proof
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    aria-label="Upload payment proof"
                    onChange={(event) => setPaymentProofFile(event.target.files?.[0] ?? null)}
                    className="pib-input mt-1 w-full"
                  />
                </label>

                <label className="pib-label block">
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
                  className="btn-pib-primary"
                >
                  {uploadingPaymentProof ? 'Submitting proof…' : 'Submit proof of payment'}
                </button>

                {paymentProofMessage ? (
                  <p className="text-sm">{paymentProofMessage}</p>
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
            <p className="text-sm font-medium text-[var(--color-pib-text)]">Draft invoice editor</p>
            <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">Update the editable draft fields before sending this invoice.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-[var(--color-pib-text-muted)]">Due date
              <input
                type="date"
                value={draftForm.dueDate}
                onChange={(event) => setDraftForm((current) => ({ ...current, dueDate: event.target.value }))}
                className="pib-input mt-1 w-full"
              />
            </label>
            <label className="text-xs text-[var(--color-pib-text-muted)]">Tax rate
              <input
                type="number"
                min="0"
                max="100"
                value={draftForm.taxRate}
                onChange={(event) => setDraftForm((current) => ({ ...current, taxRate: event.target.value }))}
                className="pib-input mt-1 w-full"
              />
            </label>
            <label className="text-xs text-[var(--color-pib-text-muted)] sm:col-span-2">Line item description
              <input
                value={draftForm.description}
                onChange={(event) => setDraftForm((current) => ({ ...current, description: event.target.value }))}
                className="pib-input mt-1 w-full"
              />
            </label>
            <label className="text-xs text-[var(--color-pib-text-muted)]">Quantity
              <input
                type="number"
                min="1"
                value={draftForm.quantity}
                onChange={(event) => setDraftForm((current) => ({ ...current, quantity: event.target.value }))}
                className="pib-input mt-1 w-full"
              />
            </label>
            <label className="text-xs text-[var(--color-pib-text-muted)]">Unit price
              <input
                type="number"
                min="0"
                step="0.01"
                value={draftForm.unitPrice}
                onChange={(event) => setDraftForm((current) => ({ ...current, unitPrice: event.target.value }))}
                className="pib-input mt-1 w-full"
              />
            </label>
            <label className="text-xs text-[var(--color-pib-text-muted)] sm:col-span-2">Notes
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
            <p className="text-sm font-medium text-[var(--color-pib-text)]">Recurring Invoice</p>
            {schedule ? (
              <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">
                {INTERVAL_LABELS[schedule.interval as RecurrenceInterval] ?? schedule.interval} · Status: {schedule.status}
              </p>
            ) : (
              <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">Not set up</p>
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
          <div className="space-y-3 border-t border-[var(--color-pib-line)] pt-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="pib-label block mb-1">Interval</label>
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
                <label className="pib-label block mb-1">Start Date</label>
                <input
                  type="date"
                  value={recurringStartDate}
                  onChange={e => setRecurringStartDate(e.target.value)}
                  className="pib-input w-full text-sm"
                />
              </div>
              <div>
                <label className="pib-label block mb-1">End Date (optional)</label>
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
