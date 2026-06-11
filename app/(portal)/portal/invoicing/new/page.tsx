'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import InvoicePreviewModal from './invoice-preview-modal'

interface LineItem {
  description: string
  quantity: number
  unitPrice: number
}

interface OrgOption {
  id: string
  name: string
  slug: string
  type?: string
}

type Currency = 'USD' | 'EUR' | 'ZAR'

const CURRENCY_LOCALES: Record<Currency, string> = { USD: 'en-US', EUR: 'de-DE', ZAR: 'en-ZA' }

function fmtCurrency(amount: number, currency: Currency): string {
  return new Intl.NumberFormat(CURRENCY_LOCALES[currency] || 'en-US', {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount)
}

function NewInvoiceForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedOrgId = searchParams.get('orgId') ?? ''

  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [orgId, setOrgId] = useState(preselectedOrgId)
  const [currency, setCurrency] = useState<Currency>('ZAR')
  const [taxRate, setTaxRate] = useState(0)
  const [notes, setNotes] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: '', quantity: 1, unitPrice: 0 },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')

  useEffect(() => {
    fetch('/api/v1/organizations')
      .then(r => r.json())
      .then((body: { data?: OrgOption[] }) => {
        const clientOrgs = (body.data ?? [])
          .filter((o) => o.type === 'client')
          .map((o) => ({ id: o.id, name: o.name, slug: o.slug }))
        setOrgs(clientOrgs)
      })
  }, [])

  useEffect(() => {
    if (!orgId) {
      setNextInvoiceNumber('')
      return
    }
    fetch(`/api/v1/organizations/${orgId}`)
      .then(r => r.json())
      .then(body => {
        const orgCurrency = body.data?.settings?.currency
        if (orgCurrency) setCurrency(orgCurrency as Currency)
      })
      .catch(() => {})

    fetch(`/api/v1/invoices/next-number?orgId=${orgId}`)
      .then(r => r.json())
      .then(body => {
        if (body.data?.invoiceNumber) setNextInvoiceNumber(body.data.invoiceNumber)
      })
      .catch(() => {})
  }, [orgId])

  function addLineItem() {
    setLineItems(prev => [...prev, { description: '', quantity: 1, unitPrice: 0 }])
  }

  function removeLineItem(idx: number) {
    setLineItems(prev => prev.filter((_, i) => i !== idx))
  }

  function updateLineItem(idx: number, field: keyof LineItem, value: string | number) {
    setLineItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }

  const subtotal = lineItems.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.unitPrice)), 0)
  const taxAmount = subtotal * (taxRate / 100)
  const total = subtotal + taxAmount

  async function handlePreview() {
    if (!orgId) return setError('Select a client organisation first')
    if (!lineItems.some(i => i.description && i.unitPrice > 0)) return setError('Add at least one line item')
    setError('')

    const selectedOrg = orgs.find(o => o.id === orgId)
    const res = await fetch('/api/v1/invoices/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoiceNumber: nextInvoiceNumber || 'PREVIEW',
        issueDate: { _seconds: Math.floor(Date.now() / 1000) },
        dueDate: dueDate ? { _seconds: Math.floor(new Date(dueDate).getTime() / 1000) } : null,
        lineItems: lineItems.filter(i => i.description).map(item => ({
          description: item.description,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          amount: Number(item.quantity) * Number(item.unitPrice),
        })),
        subtotal,
        taxRate,
        taxAmount,
        total,
        currency,
        notes,
        orgId,
        clientDetails: { name: selectedOrg?.name ?? orgId },
        fromDetails: { companyName: 'Partners in Biz' },
      }),
    })

    if (res.ok) {
      const html = await res.text()
      setPreviewHtml(html)
      setShowPreview(true)
    } else {
      setError('Failed to generate preview')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId) return setError('Select a client organisation')
    if (!lineItems.some(i => i.description && i.unitPrice > 0)) return setError('Add at least one line item')

    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/v1/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, currency, taxRate, notes, dueDate: dueDate || null, lineItems }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed to create invoice')
      router.push(`/portal/invoicing/${body.data.id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create invoice')
      setSaving(false)
    }
  }

  const inputClass = 'pib-input'

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Invoicing / New</p>
        <h1 className="text-2xl font-headline font-bold text-on-surface">New Invoice</h1>
        {nextInvoiceNumber && (
          <p className="text-sm text-on-surface-variant mt-1">
            Invoice #: <span className="font-mono text-on-surface">{nextInvoiceNumber}</span>
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="pib-card space-y-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Invoice Details</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="pib-label">Client Organisation *</label>
              <select value={orgId} onChange={e => setOrgId(e.target.value)} className="pib-select">
                <option value="">Select organisation…</option>
                {orgs.map(org => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="pib-label">Currency</label>
              <select value={currency} onChange={e => setCurrency(e.target.value as Currency)} className="pib-select">
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="ZAR">ZAR (R)</option>
              </select>
            </div>
            <div>
              <label className="pib-label">Due Date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="pib-label">Tax Rate (%)</label>
              <input type="number" min="0" max="100" value={taxRate} onChange={e => setTaxRate(Number(e.target.value))} className={inputClass} />
            </div>
          </div>
        </div>

        <div className="pib-card space-y-3">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Line Items</p>
          <div className="hidden sm:grid grid-cols-12 gap-2 text-[9px] font-label uppercase tracking-widest text-on-surface-variant">
            <span className="col-span-6">Description</span>
            <span className="col-span-2">Qty</span>
            <span className="col-span-2">Unit Price</span>
            <span className="col-span-2">Amount</span>
          </div>
          {lineItems.map((item, idx) => (
            <div key={idx} className="grid grid-cols-2 sm:grid-cols-12 gap-2 sm:items-center pb-3 sm:pb-0 border-b border-[var(--color-card-border)] sm:border-0 last:border-b-0">
              <div className="col-span-2 sm:col-span-6">
                <label className="pib-label sm:hidden">Description</label>
                <input value={item.description} onChange={e => updateLineItem(idx, 'description', e.target.value)} className={inputClass} placeholder="Description" />
              </div>
              <div className="sm:col-span-2">
                <label className="pib-label sm:hidden">Qty</label>
                <input type="number" min="1" value={item.quantity} onChange={e => updateLineItem(idx, 'quantity', e.target.value)} className={inputClass} />
              </div>
              <div className="sm:col-span-2">
                <label className="pib-label sm:hidden">Unit Price</label>
                <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={e => updateLineItem(idx, 'unitPrice', e.target.value)} className={inputClass} />
              </div>
              <div className="col-span-2 sm:col-span-2 flex items-center justify-between sm:justify-start gap-2">
                <div className="text-sm text-on-surface">
                  <span className="sm:hidden text-xs text-on-surface-variant mr-2 uppercase tracking-widest">Amount:</span>
                  {fmtCurrency(Number(item.quantity) * Number(item.unitPrice), currency)}
                </div>
                <button type="button" onClick={() => removeLineItem(idx)} className="text-on-surface-variant hover:text-red-400 transition-colors text-lg leading-none sm:ml-auto" aria-label="Remove line">×</button>
              </div>
            </div>
          ))}
          <button type="button" onClick={addLineItem} className="pib-btn-secondary text-xs font-label">+ Add Line</button>

          <div className="border-t border-[var(--color-card-border)] pt-3 space-y-1 text-right">
            <p className="text-sm text-on-surface-variant">Subtotal: <span className="text-on-surface">{fmtCurrency(subtotal, currency)}</span></p>
            {taxRate > 0 && <p className="text-sm text-on-surface-variant">Tax ({taxRate}%): <span className="text-on-surface">{fmtCurrency(taxAmount, currency)}</span></p>}
            <p className="text-base font-bold text-on-surface">Total: {fmtCurrency(total, currency)}</p>
          </div>
        </div>

        <div className="pib-card">
          <label className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant block mb-2">Notes / Terms</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} className="pib-textarea" rows={3} placeholder="Payment terms, thank you note, etc." />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={saving} className="pib-btn-primary font-label flex-1 sm:flex-none justify-center">
            {saving ? 'Creating…' : 'Create Invoice'}
          </button>
          <button type="button" onClick={handlePreview} className="pib-btn-secondary font-label flex-1 sm:flex-none justify-center">
            Preview Invoice
          </button>
          <button type="button" onClick={() => router.back()} className="pib-btn-secondary font-label flex-1 sm:flex-none justify-center">Cancel</button>
        </div>
      </form>

      {showPreview && (
        <InvoicePreviewModal html={previewHtml} onClose={() => setShowPreview(false)} />
      )}
    </div>
  )
}

export default function NewInvoicePage() {
  return (
    <Suspense>
      <NewInvoiceForm />
    </Suspense>
  )
}
