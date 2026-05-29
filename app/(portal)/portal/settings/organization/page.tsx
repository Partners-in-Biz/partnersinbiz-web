// app/(portal)/portal/settings/organization/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'

type BillingContact = {
  name?: string
  title?: string
  email?: string
  phone?: string
}

type BillingAddress = {
  line1?: string
  line2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
}

type OrganizationSettingsResponse = {
  organization?: {
    name?: string
    website?: string
    industry?: string
    billingEmail?: string
    billingDetails?: {
      legalName?: string
      tradingName?: string
      registrationNumber?: string
      vatNumber?: string
      taxNumber?: string
      phone?: string
      address?: BillingAddress
      accountsContact?: BillingContact
      authorizedSignatory?: BillingContact
      purchaseOrderRequired?: boolean
      purchaseOrderNumber?: string
      invoiceInstructions?: string
    }
  }
  permissions?: { canEdit?: boolean; role?: string | null }
  error?: string
}

type FormState = {
  name: string
  website: string
  industry: string
  billingEmail: string
  legalName: string
  tradingName: string
  registrationNumber: string
  vatNumber: string
  taxNumber: string
  phone: string
  line1: string
  line2: string
  city: string
  state: string
  postalCode: string
  country: string
  accountsContactName: string
  accountsContactTitle: string
  accountsContactEmail: string
  accountsContactPhone: string
  authorizedSignatoryName: string
  authorizedSignatoryTitle: string
  authorizedSignatoryEmail: string
  authorizedSignatoryPhone: string
  purchaseOrderRequired: boolean
  purchaseOrderNumber: string
  invoiceInstructions: string
}

type TextField = {
  [K in keyof FormState]: FormState[K] extends string ? K : never
}[keyof FormState]

const emptyForm: FormState = {
  name: '',
  website: '',
  industry: '',
  billingEmail: '',
  legalName: '',
  tradingName: '',
  registrationNumber: '',
  vatNumber: '',
  taxNumber: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
  accountsContactName: '',
  accountsContactTitle: '',
  accountsContactEmail: '',
  accountsContactPhone: '',
  authorizedSignatoryName: '',
  authorizedSignatoryTitle: '',
  authorizedSignatoryEmail: '',
  authorizedSignatoryPhone: '',
  purchaseOrderRequired: false,
  purchaseOrderNumber: '',
  invoiceInstructions: '',
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toForm(data: OrganizationSettingsResponse): FormState {
  const org = data.organization ?? {}
  const billing = org.billingDetails ?? {}
  const address = billing.address ?? {}
  const accounts = billing.accountsContact ?? {}
  const signatory = billing.authorizedSignatory ?? {}

  return {
    name: stringValue(org.name),
    website: stringValue(org.website),
    industry: stringValue(org.industry),
    billingEmail: stringValue(org.billingEmail),
    legalName: stringValue(billing.legalName),
    tradingName: stringValue(billing.tradingName),
    registrationNumber: stringValue(billing.registrationNumber),
    vatNumber: stringValue(billing.vatNumber),
    taxNumber: stringValue(billing.taxNumber),
    phone: stringValue(billing.phone),
    line1: stringValue(address.line1),
    line2: stringValue(address.line2),
    city: stringValue(address.city),
    state: stringValue(address.state),
    postalCode: stringValue(address.postalCode),
    country: stringValue(address.country),
    accountsContactName: stringValue(accounts.name),
    accountsContactTitle: stringValue(accounts.title),
    accountsContactEmail: stringValue(accounts.email),
    accountsContactPhone: stringValue(accounts.phone),
    authorizedSignatoryName: stringValue(signatory.name),
    authorizedSignatoryTitle: stringValue(signatory.title),
    authorizedSignatoryEmail: stringValue(signatory.email),
    authorizedSignatoryPhone: stringValue(signatory.phone),
    purchaseOrderRequired: billing.purchaseOrderRequired === true,
    purchaseOrderNumber: stringValue(billing.purchaseOrderNumber),
    invoiceInstructions: stringValue(billing.invoiceInstructions),
  }
}

function toPayload(form: FormState) {
  return {
    name: form.name,
    website: form.website,
    industry: form.industry,
    billingEmail: form.billingEmail,
    billingDetails: {
      legalName: form.legalName,
      tradingName: form.tradingName,
      registrationNumber: form.registrationNumber,
      vatNumber: form.vatNumber,
      taxNumber: form.taxNumber,
      phone: form.phone,
      address: {
        line1: form.line1,
        line2: form.line2,
        city: form.city,
        state: form.state,
        postalCode: form.postalCode,
        country: form.country,
      },
      accountsContact: {
        name: form.accountsContactName,
        title: form.accountsContactTitle,
        email: form.accountsContactEmail,
        phone: form.accountsContactPhone,
      },
      authorizedSignatory: {
        name: form.authorizedSignatoryName,
        title: form.authorizedSignatoryTitle,
        email: form.authorizedSignatoryEmail,
        phone: form.authorizedSignatoryPhone,
      },
      purchaseOrderRequired: form.purchaseOrderRequired,
      purchaseOrderNumber: form.purchaseOrderNumber,
      invoiceInstructions: form.invoiceInstructions,
    },
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pib-card space-y-4">
      <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{title}</p>
      {children}
    </div>
  )
}

export default function OrganizationSettingsPage() {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [canEdit, setCanEdit] = useState(false)
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetch('/api/v1/portal/settings/organization')
      .then(async (res) => {
        const body = await res.json().catch(() => ({})) as OrganizationSettingsResponse
        if (!res.ok) throw new Error(body.error ?? 'Failed to load organisation details')
        return body
      })
      .then((body) => {
        if (!alive) return
        setForm(toForm(body))
        setCanEdit(body.permissions?.canEdit === true)
        setRole(body.permissions?.role ?? null)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load organisation details')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => { alive = false }
  }, [])

  function updateText(field: TextField, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!canEdit) return
    setSaving(true)
    setSaved(false)
    setError('')

    const res = await fetch('/api/v1/portal/settings/organization', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toPayload(form)),
    })
    const body = await res.json().catch(() => ({})) as OrganizationSettingsResponse
    if (res.ok) {
      setSaved(true)
      if (body.organization) setForm(toForm(body))
      setTimeout(() => setSaved(false), 3000)
    } else {
      setError(body.error ?? 'Failed to save organisation details')
    }
    setSaving(false)
  }

  function field(label: string, key: TextField, options: { type?: string; required?: boolean } = {}) {
    const id = `org-${key}`
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="pib-label !mb-0">
          {label}{options.required && ' *'}
        </label>
        <input
          id={id}
          type={options.type ?? 'text'}
          value={form[key]}
          onChange={(e) => updateText(key, e.target.value)}
          disabled={!canEdit}
          required={options.required}
          className="pib-input disabled:opacity-60"
        />
      </div>
    )
  }

  if (loading) return <div className="text-sm text-[var(--color-pib-text-muted)]">Loading...</div>

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-lg font-semibold mb-1">Organisation details</h1>
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          Legal, billing, and agreement details for accepted proposals and future agreements.
        </p>
      </div>

      {role && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-pib-text-muted)]">Workspace role:</span>
          <span className="pill !text-[11px] !py-0.5 !px-2 capitalize">{role}</span>
          {!canEdit && <span className="text-xs text-[var(--color-pib-text-muted)]">Read only</span>}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-5">
        <Section title="Organisation">
          <div className="grid gap-4 sm:grid-cols-2">
            {field('Organisation name', 'name', { required: true })}
            {field('Website', 'website')}
            {field('Industry', 'industry')}
            {field('Billing email', 'billingEmail', { type: 'email' })}
          </div>
        </Section>

        <Section title="Legal details">
          <div className="grid gap-4 sm:grid-cols-2">
            {field('Legal company name', 'legalName')}
            {field('Trading name', 'tradingName')}
            {field('Registration number', 'registrationNumber')}
            {field('VAT number', 'vatNumber')}
            {field('Tax number', 'taxNumber')}
            {field('Phone', 'phone')}
          </div>
        </Section>

        <Section title="Billing address">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">{field('Street address', 'line1')}</div>
            <div className="sm:col-span-2">{field('Address line 2', 'line2')}</div>
            {field('City', 'city')}
            {field('State / Province', 'state')}
            {field('Postal code', 'postalCode')}
            {field('Country', 'country')}
          </div>
        </Section>

        <Section title="Agreement contacts">
          <div className="grid gap-4 sm:grid-cols-2">
            {field('Authorised signatory name', 'authorizedSignatoryName')}
            {field('Authorised signatory title', 'authorizedSignatoryTitle')}
            {field('Authorised signatory email', 'authorizedSignatoryEmail', { type: 'email' })}
            {field('Authorised signatory phone', 'authorizedSignatoryPhone')}
            {field('Accounts contact name', 'accountsContactName')}
            {field('Accounts contact title', 'accountsContactTitle')}
            {field('Accounts contact email', 'accountsContactEmail', { type: 'email' })}
            {field('Accounts contact phone', 'accountsContactPhone')}
          </div>
        </Section>

        <Section title="Invoicing">
          <div className="space-y-4">
            <label className="flex items-center gap-3 text-sm text-on-surface">
              <input
                type="checkbox"
                checked={form.purchaseOrderRequired}
                onChange={(e) => setForm((prev) => ({ ...prev, purchaseOrderRequired: e.target.checked }))}
                disabled={!canEdit}
                className="h-4 w-4 rounded border-outline text-primary disabled:opacity-60"
              />
              Purchase order required
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              {field('Purchase order number', 'purchaseOrderNumber')}
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label htmlFor="org-invoiceInstructions" className="pib-label !mb-0">Invoice instructions</label>
                <textarea
                  id="org-invoiceInstructions"
                  value={form.invoiceInstructions}
                  onChange={(e) => updateText('invoiceInstructions', e.target.value)}
                  disabled={!canEdit}
                  rows={4}
                  className="pib-textarea disabled:opacity-60"
                />
              </div>
            </div>
          </div>
        </Section>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={saving || !canEdit}
          className="pib-btn-primary w-full justify-center disabled:opacity-60 sm:w-auto"
        >
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save organisation details'}
        </button>
      </form>
    </div>
  )
}
