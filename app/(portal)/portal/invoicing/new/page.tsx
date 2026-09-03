'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { PageHeader } from '@/components/ui/AppFoundation'
import {
  Button,
  Field,
  Input,
  Notice,
  Panel,
  Select,
  Textarea,
  Title,
} from '@/components/studio'
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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow="Invoicing"
        title="New invoice."
        description={nextInvoiceNumber ? `Next number ${nextInvoiceNumber}.` : 'Create a draft invoice for a client organisation.'}
      />

      <form onSubmit={handleSubmit} className="flex flex-col gap-8">
        <Panel className="space-y-4">
          <Title as="h2">Invoice details</Title>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="invoice-org" label="Client organisation">
              <Select id="invoice-org" value={orgId} aria-label="Client organisation" onChange={e => setOrgId(e.target.value)} required>
                <option value="">Select organisation</option>
                {orgs.map(org => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </Select>
            </Field>
            <Field id="invoice-currency" label="Currency">
              <Select id="invoice-currency" value={currency} aria-label="Currency" onChange={e => setCurrency(e.target.value as Currency)}>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="ZAR">ZAR (R)</option>
              </Select>
            </Field>
            <Field id="invoice-due" label="Due date">
              <Input id="invoice-due" type="date" value={dueDate} aria-label="Due date" onChange={e => setDueDate(e.target.value)} />
            </Field>
            <Field id="invoice-tax" label="Tax rate (%)">
              <Input id="invoice-tax" type="number" min="0" max="100" value={taxRate} aria-label="Tax rate (%)" onChange={e => setTaxRate(Number(e.target.value))} />
            </Field>
          </div>
        </Panel>

        <Panel className="space-y-4">
          <Title as="h2">Line items</Title>
          <div className="sc-tiny hidden gap-2 sm:grid sm:grid-cols-12">
            <span className="col-span-6">Description</span>
            <span className="col-span-2">Qty</span>
            <span className="col-span-2">Unit price</span>
            <span className="col-span-2">Amount</span>
          </div>
          {lineItems.map((item, idx) => (
            <div key={idx} className="grid grid-cols-2 gap-2 border-b border-[var(--sc-line)] pb-4 last:border-b-0 sm:grid-cols-12 sm:items-end sm:border-0 sm:pb-0">
              <div className="col-span-2 sm:col-span-6">
                <Field id={`line-desc-${idx}`} label={idx === 0 ? 'Description' : `Description ${idx + 1}`}>
                  <Input
                    id={`line-desc-${idx}`}
                    value={item.description}
                    aria-label={idx === 0 ? 'Description' : `Description ${idx + 1}`}
                    onChange={e => updateLineItem(idx, 'description', e.target.value)}
                    placeholder="Description"
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field id={`line-qty-${idx}`} label="Qty">
                  <Input 
                    id={`line-qty-${idx}`}
                    type="number"
                    min="1"
                    value={item.quantity}
                    aria-label="Qty" onChange={e => updateLineItem(idx, 'quantity', e.target.value)}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field id={`line-price-${idx}`} label="Unit price">
                  <Input 
                    id={`line-price-${idx}`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unitPrice}
                    aria-label="Unit price" onChange={e => updateLineItem(idx, 'unitPrice', e.target.value)}
                  />
                </Field>
              </div>
              <div className="col-span-2 flex items-center justify-between gap-2 sm:col-span-2 sm:justify-start sm:pb-2">
                <span className="st-num">{fmtCurrency(Number(item.quantity) * Number(item.unitPrice), currency)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeLineItem(idx)}
                  aria-label="Remove line"
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={addLineItem}>
            Add line
          </Button>

          <div className="space-y-1 border-t border-[var(--sc-line)] pt-4 text-right">
            <p className="sc-body text-[var(--sc-ink-soft)]">
              Subtotal: <span className="st-num text-[var(--sc-ink)]">{fmtCurrency(subtotal, currency)}</span>
            </p>
            {taxRate > 0 ? (
              <p className="sc-body text-[var(--sc-ink-soft)]">
                Tax ({taxRate}%): <span className="st-num text-[var(--sc-ink)]">{fmtCurrency(taxAmount, currency)}</span>
              </p>
            ) : null}
            <p className="st-title">
              Total: <span className="st-num">{fmtCurrency(total, currency)}</span>
            </p>
          </div>
        </Panel>

        <Panel>
          <Field id="invoice-notes" label="Notes / terms">
            <Textarea 
              id="invoice-notes"
              value={notes}
              aria-label="Notes / terms" onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Payment terms, thank you note, etc."
            />
          </Field>
        </Panel>

        {error ? <Notice tone="danger">{error}</Notice> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={saving}>
            {saving ? 'Creating…' : 'Create invoice'}
          </Button>
          <Button type="button" variant="secondary" onClick={handlePreview}>
            Preview invoice
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>

      <InvoicePreviewModal open={showPreview} html={previewHtml} onClose={() => setShowPreview(false)} />
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
