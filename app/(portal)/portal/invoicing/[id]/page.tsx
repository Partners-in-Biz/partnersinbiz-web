'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { PaymentInstructions } from '@/lib/invoices/types'
import { INTERVAL_LABELS, RecurrenceInterval } from '@/lib/invoices/recurring'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import { ShareWithPartnerButton } from '@/components/crm/ShareWithPartnerButton'
import { EmptyState, PageHeader } from '@/components/ui/AppFoundation'
import {
  Button,
  ButtonLink,
  DataItem,
  DataList,
  Field,
  Input,
  Notice,
  Panel,
  Select,
  Skeleton,
  Status,
  Table,
  THead,
  TR,
  TH,
  TD,
  Textarea,
  Title,
} from '@/components/studio'

type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'payment_pending_verification' | 'paid' | 'partially_paid' | 'overdue' | 'cancelled'
type StatusTone = 'success' | 'warning' | 'danger' | 'info' | undefined

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
  issueDate?: unknown
  dueDate?: unknown
  paidAt?: unknown
  sentAt?: unknown
  canEdit?: boolean
  canSend?: boolean
  canCancel?: boolean
  canMarkPaid?: boolean
  clientDetails?: { name?: string }
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

const STATUS_TONE: Record<InvoiceStatus, StatusTone> = {
  draft: undefined,
  sent: 'info',
  viewed: 'info',
  payment_pending_verification: 'warning',
  paid: 'success',
  partially_paid: 'success',
  overdue: 'danger',
  cancelled: undefined,
}

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  payment_pending_verification: 'Payment review',
  paid: 'Paid',
  partially_paid: 'Partially paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
}

function formatDate(ts: unknown) {
  if (!ts) return '-'
  const candidate = ts as { _seconds?: number; seconds?: number }
  const d = candidate._seconds
    ? new Date(candidate._seconds * 1000)
    : candidate.seconds
      ? new Date(candidate.seconds * 1000)
      : new Date(ts as string)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
  const [schedule, setSchedule] = useState<{ id: string; status: string; interval: string; nextDueAt: unknown } | null>(null)
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
      const match = (schedulesBody.data ?? []).find((s: { invoiceId?: string; status?: string }) => s.invoiceId === id && s.status !== 'cancelled')
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

  if (loading) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Skeleton height={48} width="16rem" />
        <Skeleton height={320} width="100%" />
      </div>
    )
  }

  if (!invoice) {
    return (
      <EmptyState
        title="Invoice not found."
        description="This invoice may have been deleted or you may not have access."
        action={<ButtonLink href={scopedPortalPath('/portal/invoicing', orgScope)} variant="secondary" size="sm">Back to invoicing</ButtonLink>}
      />
    )
  }

  const taxLabel = invoice.currency === 'ZAR' ? 'VAT' : 'Tax'
  const canShowPaymentWorkspace = !['draft', 'paid', 'cancelled'].includes(invoice.status)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div>
        <Link href={scopedPortalPath('/portal/invoicing', orgScope)} className="sc-tiny">
          ← Invoicing
        </Link>
      </div>

      <PageHeader
        eyebrow="Invoicing"
        title={invoice.invoiceNumber}
        description={`Issued ${formatDate(invoice.issueDate)}. Due ${formatDate(invoice.dueDate)}.`}
        meta={<Status tone={STATUS_TONE[invoice.status]}>{STATUS_LABEL[invoice.status]}</Status>}
        actions={(
          <>
            <a
              href={scopedApiPath(`/api/v1/invoices/${id}/pdf`, orgScope)}
              target="_blank"
              rel="noopener noreferrer"
              className="st-btn st-btn--secondary st-btn--sm"
            >
              📄 Download PDF
            </a>
            <Button type="button" variant="secondary" size="sm" onClick={handleDuplicate} loading={duplicating}>
              {duplicating ? 'Duplicating…' : 'Duplicate'}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={handlePrint}>
              Print
            </Button>
            <ShareWithPartnerButton resourceType="invoice" resourceId={id} />
          </>
        )}
      />

      <div id="invoice-print">
      <Panel className="space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
          <div>
            <Title as="h2">Partners in Biz</Title>
            <p className="sc-body mt-1 text-[var(--sc-ink-soft)]">partnersinbiz.online</p>
          </div>
          <div className="sm:text-right">
            <p className="st-num text-[1.5rem] text-[var(--sc-ink)]">{invoice.invoiceNumber}</p>
            <p className="sc-tiny mt-2">Issued {formatDate(invoice.issueDate)}</p>
            <p className="sc-tiny">Due {formatDate(invoice.dueDate)}</p>
          </div>
        </div>

        <div>
          <p className="sc-tiny">Bill to</p>
          <p className="sc-body mt-1" style={{ color: 'var(--sc-ink)' }}>
            {invoice.clientDetails?.name ?? invoice.orgId}
          </p>
        </div>

        <div className="hidden sm:block">
          <Table>
            <THead>
              <TR>
                <TH>Description</TH>
                <TH className="text-right">Qty</TH>
                <TH className="text-right">Unit</TH>
                <TH className="text-right">Amount</TH>
              </TR>
            </THead>
            <tbody>
              {invoice.lineItems.map((item, i) => (
                <TR key={i}>
                  <TD>{item.description}</TD>
                  <TD className="text-right"><span className="st-num">{item.quantity}</span></TD>
                  <TD className="text-right"><span className="st-num">{formatCurrencyValue(item.unitPrice, invoice.currency)}</span></TD>
                  <TD className="text-right"><span className="st-num">{formatCurrencyValue(item.amount, invoice.currency)}</span></TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </div>

        <div className="flex flex-col gap-4 sm:hidden">
          {invoice.lineItems.map((item, i) => (
            <Panel flat key={i} className="space-y-2 p-4">
              <p className="sc-body" style={{ color: 'var(--sc-ink)' }}>{item.description}</p>
              <p className="sc-tiny">Qty {item.quantity}</p>
              <p className="st-num">{formatCurrencyValue(item.amount, invoice.currency)}</p>
            </Panel>
          ))}
        </div>

        <div className="flex justify-end">
          <div className="min-w-48 space-y-1">
            <div className="flex justify-between sc-body text-[var(--sc-ink-soft)]">
              <span>Subtotal</span>
              <span className="st-num">{formatCurrencyValue(invoice.subtotal ?? 0, invoice.currency)}</span>
            </div>
            {invoice.taxRate > 0 ? (
              <div className="flex justify-between sc-body text-[var(--sc-ink-soft)]">
                <span>{taxLabel} ({invoice.taxRate}%)</span>
                <span className="st-num">{formatCurrencyValue(invoice.taxAmount ?? 0, invoice.currency)}</span>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-[var(--sc-line)] pt-2 st-title">
              <span>Total</span>
              <span className="st-num">{formatCurrencyValue(invoice.total ?? 0, invoice.currency)}</span>
            </div>
          </div>
        </div>

        {invoice.notes ? (
          <div className="border-t border-[var(--sc-line)] pt-4">
            <p className="sc-tiny">Notes</p>
            <p className="sc-body mt-1 text-[var(--sc-ink-soft)]">{invoice.notes}</p>
          </div>
        ) : null}
      </Panel>
      </div>

      {canShowPaymentWorkspace ? (
        <Panel className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Title as="h2">EFT payment</Title>
              <p className="sc-body mt-1 text-[var(--sc-ink-soft)]">
                Use the invoice number as the EFT reference, then upload proof so finance can verify it.
              </p>
            </div>
            {paymentInstructions?.publicViewUrl ? (
              <a
                href={paymentInstructions.publicViewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="st-btn st-btn--secondary st-btn--sm"
              >
                Open public invoice
              </a>
            ) : null}
          </div>

          {paymentInstructionsError ? (
            <Notice tone="danger">{paymentInstructionsError}</Notice>
          ) : paymentInstructions ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Panel flat className="p-4">
                <Title as="h2">Bank details</Title>
                <DataList className="mt-4">
                  <DataItem label="Bank">{paymentInstructions.eft.bankingDetails.bankName ?? '-'}</DataItem>
                  <DataItem label="Account name">{paymentInstructions.eft.bankingDetails.accountName ?? '-'}</DataItem>
                  <DataItem label="Account number">{paymentInstructions.eft.bankingDetails.accountNumber ?? '-'}</DataItem>
                  <DataItem label="Branch code">{paymentInstructions.eft.bankingDetails.branchCode ?? '-'}</DataItem>
                  <DataItem label="Reference">{paymentInstructions.eft.reference}</DataItem>
                </DataList>
              </Panel>

              <Panel flat className="space-y-4 p-4">
                <div>
                  <Title as="h2">Proof upload</Title>
                  <p className="sc-body mt-2 text-[var(--sc-ink-soft)]">
                    Send proof to {paymentInstructions.eft.proofOfPaymentEmail} or attach it here for verification.
                  </p>
                </div>

                {invoice.status === 'payment_pending_verification' ? (
                  <Status tone="warning">Payment proof submitted. Finance is reviewing it now.</Status>
                ) : null}

                <Field id="payment-proof-file" label="Upload payment proof">
                  <Input
                    id="payment-proof-file"
                    type="file"
                    accept="image/*,application/pdf"
                    aria-label="Upload payment proof"
                    onChange={(event) => setPaymentProofFile(event.target.files?.[0] ?? null)}
                  />
                </Field>

                <Field id="payment-proof-note" label="Payment note">
                  <Textarea
                    id="payment-proof-note"
                    aria-label="Payment note"
                    value={paymentProofNote}
                    onChange={(event) => setPaymentProofNote(event.target.value)}
                    rows={3}
                    placeholder="Add a payment reference, sending account, or anything finance should verify."
                  />
                </Field>

                <Button
                  type="button"
                  onClick={handleUploadPaymentProof}
                  disabled={!paymentProofFile}
                  loading={uploadingPaymentProof}
                >
                  {uploadingPaymentProof ? 'Submitting proof…' : 'Submit proof of payment'}
                </Button>

                {paymentProofMessage ? <Notice tone="danger">{paymentProofMessage}</Notice> : null}
              </Panel>
            </div>
          ) : (
            <Skeleton height={192} width="100%" />
          )}
        </Panel>
      ) : null}

      {invoice.status !== 'paid' && invoice.status !== 'cancelled' ? (
        <div className="flex flex-wrap justify-end gap-2">
          {invoice.canEdit && invoice.status === 'draft' ? (
            <Button type="button" variant="secondary" size="sm" onClick={startDraftEdit}>
              Edit draft invoice
            </Button>
          ) : null}
          {invoice.canSend && invoice.status === 'draft' ? (
            <Button type="button" size="sm" onClick={() => updateStatus('sent')} loading={updating}>
              {updating ? 'Updating…' : 'Mark sent'}
            </Button>
          ) : null}
          {invoice.canCancel ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => updateStatus('cancelled')} loading={updating}>
              {updating ? 'Updating…' : 'Cancel invoice'}
            </Button>
          ) : null}
        </div>
      ) : null}

      {editingDraft && invoice.canEdit && invoice.status === 'draft' ? (
        <Panel className="space-y-4">
          <div>
            <Title as="h2">Draft invoice editor</Title>
            <p className="sc-body mt-1 text-[var(--sc-ink-soft)]">Update the editable draft fields before sending this invoice.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="draft-due-date" label="Due date">
              <Input 
                id="draft-due-date"
                type="date"
                value={draftForm.dueDate}
                aria-label="Due date" onChange={(event) => setDraftForm((current) => ({ ...current, dueDate: event.target.value }))}
              />
            </Field>
            <Field id="draft-tax-rate" label="Tax rate">
              <Input 
                id="draft-tax-rate"
                type="number"
                min="0"
                max="100"
                value={draftForm.taxRate}
                aria-label="Tax rate" onChange={(event) => setDraftForm((current) => ({ ...current, taxRate: event.target.value }))}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field id="draft-line-description" label="Line item description">
                <Input 
                  id="draft-line-description"
                  value={draftForm.description}
                  aria-label="Line item description" onChange={(event) => setDraftForm((current) => ({ ...current, description: event.target.value }))}
                />
              </Field>
            </div>
            <Field id="draft-quantity" label="Quantity">
              <Input 
                id="draft-quantity"
                type="number"
                min="1"
                value={draftForm.quantity}
                aria-label="Quantity" onChange={(event) => setDraftForm((current) => ({ ...current, quantity: event.target.value }))}
              />
            </Field>
            <Field id="draft-unit-price" label="Unit price">
              <Input 
                id="draft-unit-price"
                type="number"
                min="0"
                step="0.01"
                value={draftForm.unitPrice}
                aria-label="Unit price" onChange={(event) => setDraftForm((current) => ({ ...current, unitPrice: event.target.value }))}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field id="draft-notes" label="Notes">
                <Textarea 
                  id="draft-notes"
                  value={draftForm.notes}
                  aria-label="Notes" onChange={(event) => setDraftForm((current) => ({ ...current, notes: event.target.value }))}
                  rows={2}
                />
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditingDraft(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={saveDraftInvoice} loading={savingDraft}>
              {savingDraft ? 'Saving...' : 'Save draft invoice'}
            </Button>
          </div>
        </Panel>
      ) : null}

      <Panel className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Title as="h2">Recurring invoice</Title>
            {schedule ? (
              <p className="sc-body mt-1 text-[var(--sc-ink-soft)]">
                {INTERVAL_LABELS[schedule.interval as RecurrenceInterval] ?? schedule.interval}. Status: {schedule.status}.
              </p>
            ) : (
              <p className="sc-body mt-1 text-[var(--sc-ink-soft)]">Not set up.</p>
            )}
          </div>
          {schedule ? (
            <Button type="button" variant="secondary" size="sm" onClick={handleCancelRecurring} loading={savingRecurring}>
              Cancel recurring
            </Button>
          ) : (
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowRecurringForm(v => !v)}>
              Set up recurring
            </Button>
          )}
        </div>

        {showRecurringForm && !schedule ? (
          <div className="space-y-4 border-t border-[var(--sc-line)] pt-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="recurring-interval" label="Interval">
                <Select 
                  id="recurring-interval"
                  value={recurringInterval}
                  aria-label="Interval" onChange={e => setRecurringInterval(e.target.value as RecurrenceInterval)}
                >
                  {(Object.keys(INTERVAL_LABELS) as RecurrenceInterval[]).map(k => (
                    <option key={k} value={k}>{INTERVAL_LABELS[k]}</option>
                  ))}
                </Select>
              </Field>
              <Field id="recurring-start" label="Start date">
                <Input 
                  id="recurring-start"
                  type="date"
                  value={recurringStartDate}
                  aria-label="Start date" onChange={e => setRecurringStartDate(e.target.value)}
                />
              </Field>
              <Field id="recurring-end" label="End date" hint="Optional">
                <Input 
                  id="recurring-end"
                  type="date"
                  value={recurringEndDate}
                  aria-label="End date" onChange={e => setRecurringEndDate(e.target.value)}
                />
              </Field>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={handleCreateRecurring}
              disabled={!recurringStartDate}
              loading={savingRecurring}
            >
              {savingRecurring ? 'Saving…' : 'Save recurring schedule'}
            </Button>
          </div>
        ) : null}
      </Panel>
    </div>
  )
}
