'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import InvoicePreviewModal from '../../invoicing/new/invoice-preview-modal'

interface LineItem {
  description: string
  quantity: number
  unitPrice: number
}

interface OrgOption {
  id: string
  name: string
  slug: string
}

type Currency = 'USD' | 'EUR' | 'ZAR'

const CURRENCY_LOCALES: Record<Currency, string> = { USD: 'en-US', EUR: 'de-DE', ZAR: 'en-ZA' }

function fmtCurrency(amount: number, currency: Currency): string {
  return new Intl.NumberFormat(CURRENCY_LOCALES[currency] || 'en-US', {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount)
}

function NewQuoteForm() {
  const router = useRouter()

  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [orgId, setOrgId] = useState('')
  const [currency, setCurrency] = useState<Currency>('USD')
  const [taxRate, setTaxRate] = useState(0)
  const [notes, setNotes] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: '', quantity: 1, unitPrice: 0 },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')

  useEffect(() => {
    fetch('/api/v1/organizations')
      .then(r => r.json())
      .then(body => {
        const clientOrgs = (body.data ?? [])
          .filter((o: any) => o.type === 'client')
          .map((o: any) => ({ id: o.id, name: o.name, slug: o.slug }))
        setOrgs(clientOrgs)
      })
  }, [])

  useEffect(() => {
    if (!orgId) return
    fetch(`/api/v1/organizations/${orgId}`)
      .then(r => r.json())
      .then(body => {
        const orgCurrency = body.data?.settings?.currency
        if (orgCurrency) setCurrency(orgCurrency as Currency)
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
    setError('')

    const selectedOrg = orgs.find(o => o.id === orgId)
    const res = await fetch('/api/v1/invoices/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoiceNumber: 'QUOTE PREVIEW',
        issueDate: { _seconds: Math.floor(Date.now() / 1000) },
        dueDate: validUntil ? { _seconds: Math.floor(new Date(validUntil).getTime() / 1000) } : null,
        lineItems: lineItems.filter(i => i.description).map(item => ({
          description: item.description,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          amount: Number(item.quantity) * Number(item.unitPrice),
        })),
        subtotal, taxRate, taxAmount, total, currency, notes, orgId,
        clientDetails: { name: selectedOrg?.name ?? orgId },
        fromDetails: { companyName: 'Partners in Biz' },
      }),
    })
    if (res.ok) {
      setPreviewHtml(await res.text())
      setShowPreview(true)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId) return setError('Select a client organisation')
    if (!lineItems.some(i => i.description && i.unitPrice > 0)) return setError('Add at least one line item')

    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/v1/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, currency, taxRate, notes, validUntil: validUntil || null, lineItems }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed to create quote')
      router.push(`/portal/quotes/${body.data.id}`)
    } catch (err: any) {
      setError(err.message)
      setSaving(false)
    }
  }

  const inputClass = 'pib-input'

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <header>
        <p className="sc-tiny">Quotes / New</p>
        <h1 className="pib-page-title mt-2">New Quote</h1>
      </header>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="pib-card space-y-4">
          <p className="pib-label mb-0">Quote Details</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="pib-label">Client Organisation *</label>
              <select aria-label="Client organisation" value={orgId} onChange={e => setOrgId(e.target.value)} className="pib-select">
                <option value="">Select organisation…</option>
                {orgs.map(org => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="pib-label">Currency</label>
              <select aria-label="Currency" value={currency} onChange={e => setCurrency(e.target.value as Currency)} className="pib-select">
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="ZAR">ZAR (R)</option>
              </select>
            </div>
            <div>
              <label className="pib-label">Valid Until</label>
              <input aria-label="Valid until" type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="pib-label">Tax Rate (%)</label>
              <input aria-label="Tax rate percent" type="number" min="0" max="100" value={taxRate} onChange={e => setTaxRate(Number(e.target.value))} className={inputClass} />
            </div>
          </div>
        </div>

        <div className="pib-card space-y-3">
          <p className="pib-label mb-0">Line Items</p>
          <div className="hidden sm:grid grid-cols-12 gap-2 pib-label mb-0">
            <span className="col-span-6">Description</span>
            <span className="col-span-2">Qty</span>
            <span className="col-span-2">Unit Price</span>
            <span className="col-span-2">Amount</span>
          </div>
          {lineItems.map((item, idx) => (
            <div key={idx} className="grid grid-cols-2 sm:grid-cols-12 gap-2 sm:items-center pb-3 sm:pb-0 border-b border-[var(--color-pib-line)] sm:border-0 last:border-b-0">
              <div className="col-span-2 sm:col-span-6">
                <label className="pib-label sm:hidden">Description</label>
                <input aria-label="Line item description" value={item.description} onChange={e => updateLineItem(idx, 'description', e.target.value)} className={inputClass} placeholder="Description" />
              </div>
              <div className="sm:col-span-2">
                <label className="pib-label sm:hidden">Qty</label>
                <input aria-label="Line item quantity" type="number" min="1" value={item.quantity} onChange={e => updateLineItem(idx, 'quantity', e.target.value)} className={inputClass} />
              </div>
              <div className="sm:col-span-2">
                <label className="pib-label sm:hidden">Unit Price</label>
                <input aria-label="Line item unit price" type="number" min="0" step="0.01" value={item.unitPrice} onChange={e => updateLineItem(idx, 'unitPrice', e.target.value)} className={inputClass} />
              </div>
              <div className="col-span-2 sm:col-span-2 flex items-center justify-between sm:justify-start gap-2">
                <div className="text-sm text-[var(--color-pib-text)]">
                  <span className="sm:hidden text-xs text-[var(--color-pib-text-muted)] mr-2 uppercase tracking-widest">Amount:</span>
                  {fmtCurrency(Number(item.quantity) * Number(item.unitPrice), currency)}
                </div>
                <button type="button" onClick={() => removeLineItem(idx)} className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-error)] transition-colors text-lg leading-none sm:ml-auto" aria-label="Remove line">×</button>
              </div>
            </div>
          ))}
          <button type="button" onClick={addLineItem} className="btn-pib-secondary text-xs">+ Add Line</button>

          <div className="border-t border-[var(--color-pib-line)] pt-3 space-y-1 text-right">
            <p className="text-sm text-[var(--color-pib-text-muted)]">Subtotal: <span className="text-[var(--color-pib-text)]">{fmtCurrency(subtotal, currency)}</span></p>
            {taxRate > 0 && <p className="text-sm text-[var(--color-pib-text-muted)]">Tax ({taxRate}%): <span className="text-[var(--color-pib-text)]">{fmtCurrency(taxAmount, currency)}</span></p>}
            <p className="text-base text-[var(--color-pib-text)]">Total: {fmtCurrency(total, currency)}</p>
          </div>
        </div>

        <div className="pib-card">
          <label className="pib-label">Notes / Terms</label>
          <textarea aria-label="Notes and terms" value={notes} onChange={e => setNotes(e.target.value)} className="pib-textarea" rows={3} placeholder="Payment terms, validity, etc." />
        </div>

        {error && <p className="text-sm text-[var(--color-error)]">{error}</p>}

        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={saving} className="btn-pib-primary flex-1 sm:flex-none justify-center">
            {saving ? 'Creating…' : 'Create Quote'}
          </button>
          <button type="button" onClick={handlePreview} className="btn-pib-secondary flex-1 sm:flex-none justify-center">Preview</button>
          <button type="button" onClick={() => router.back()} className="btn-pib-secondary flex-1 sm:flex-none justify-center">Cancel</button>
        </div>
      </form>

      {showPreview && <InvoicePreviewModal html={previewHtml} onClose={() => setShowPreview(false)} />}
    </div>
  )
}

export default function NewQuotePage() {
  return (
    <Suspense>
      <NewQuoteForm />
    </Suspense>
  )
}
