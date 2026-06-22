// app/(portal)/portal/settings/organization/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

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

const TIMEZONES = [
  { value: 'Africa/Johannesburg', label: 'Africa/Johannesburg (SAST, UTC+2)' },
  { value: 'Africa/Nairobi',      label: 'Africa/Nairobi (EAT, UTC+3)' },
  { value: 'Africa/Lagos',        label: 'Africa/Lagos (WAT, UTC+1)' },
  { value: 'Africa/Cairo',        label: 'Africa/Cairo (EET, UTC+2)' },
  { value: 'Europe/London',       label: 'Europe/London (GMT/BST)' },
  { value: 'Europe/Paris',        label: 'Europe/Paris (CET, UTC+1)' },
  { value: 'Europe/Berlin',       label: 'Europe/Berlin (CET, UTC+1)' },
  { value: 'Europe/Amsterdam',    label: 'Europe/Amsterdam (CET, UTC+1)' },
  { value: 'America/New_York',    label: 'America/New_York (EST/EDT)' },
  { value: 'America/Chicago',     label: 'America/Chicago (CST/CDT)' },
  { value: 'America/Denver',      label: 'America/Denver (MST/MDT)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PST/PDT)' },
  { value: 'America/Sao_Paulo',   label: 'America/Sao_Paulo (BRT, UTC−3)' },
  { value: 'Asia/Dubai',          label: 'Asia/Dubai (GST, UTC+4)' },
  { value: 'Asia/Singapore',      label: 'Asia/Singapore (SST, UTC+8)' },
  { value: 'Asia/Tokyo',          label: 'Asia/Tokyo (JST, UTC+9)' },
  { value: 'Australia/Sydney',    label: 'Australia/Sydney (AEST/AEDT)' },
  { value: 'Pacific/Auckland',    label: 'Pacific/Auckland (NZST/NZDT)' },
]

type OrganizationSettingsResponse = {
  organization?: {
    name?: string
    website?: string
    industry?: string
    billingEmail?: string
    timezone?: string
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

function isFilled(value: string) {
  return value.trim().length > 0
}

function countReadyAreas(form: FormState) {
  return [
    isFilled(form.legalName) && isFilled(form.registrationNumber),
    isFilled(form.billingEmail) && isFilled(form.line1) && isFilled(form.city),
    isFilled(form.authorizedSignatoryName) && isFilled(form.authorizedSignatoryEmail),
    isFilled(form.accountsContactName) && isFilled(form.accountsContactEmail),
  ].filter(Boolean).length
}

export default function OrganizationSettingsPage() {
  const searchParams = useSearchParams()
  const organizationEndpoint = scopedApiPath('/api/v1/portal/settings/organization', scopeFromSearchParams(searchParams))
  const [form, setForm] = useState<FormState>(emptyForm)
  const [canEdit, setCanEdit] = useState(false)
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Timezone state — independent of main form save
  const [timezone, setTimezone] = useState('Africa/Johannesburg')
  const [tzSaving, setTzSaving] = useState(false)
  const [tzSaved, setTzSaved] = useState(false)
  const [tzError, setTzError] = useState('')

  useEffect(() => {
    let alive = true
    fetch(organizationEndpoint)
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
        if (body.organization?.timezone) setTimezone(body.organization.timezone)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load organisation details')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => { alive = false }
  }, [organizationEndpoint])

  function updateText(field: TextField, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!canEdit) return
    setSaving(true)
    setSaved(false)
    setError('')

    const res = await fetch(organizationEndpoint, {
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

  async function handleSaveTimezone() {
    if (!canEdit) return
    setTzSaving(true)
    setTzSaved(false)
    setTzError('')
    try {
      const res = await fetch(organizationEndpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone }),
      })
      if (res.ok) {
        setTzSaved(true)
        setTimeout(() => setTzSaved(false), 3000)
      } else {
        const body = await res.json().catch(() => ({})) as OrganizationSettingsResponse
        setTzError(body.error ?? 'Failed to save timezone')
      }
    } catch {
      setTzError('Failed to save timezone')
    }
    setTzSaving(false)
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

  const readyAreas = countReadyAreas(form)
  const accessLabel = canEdit ? `${role ? role[0].toUpperCase() + role.slice(1) : 'Editor'} access` : 'Read-only access'
  const invoicePolicy = form.purchaseOrderRequired ? 'Purchase order required' : 'No purchase order required'
  const legalIdentity = form.legalName || form.name || 'Legal identity missing'
  const billingContact = form.billingEmail || form.accountsContactEmail || 'Billing contact missing'
  const agreementOwner = form.authorizedSignatoryName || 'Signatory missing'

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-48 rounded bg-[var(--color-pib-surface-soft)]" />
        <div className="pib-card space-y-3">
          <div className="h-5 w-60 rounded bg-[var(--color-pib-surface-soft)]" />
          <div className="h-4 w-full max-w-xl rounded bg-[var(--color-pib-surface-soft)]" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">CRM settings</p>
        <h1 className="pib-page-title mt-2">Organisation details</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
          Keep legal, billing, agreement, and invoicing data ready before proposals, projects, and finance work scale across the team.
        </p>
      </div>

      <section role="region" aria-label="Organisation command center" className="space-y-4">
        <div className="pib-card space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="eyebrow !text-[10px]">Operating readiness</p>
              <h2 className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">Organisation command center</h2>
              <p className="mt-2 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
                Review the company identity, billing route, agreement owner, and invoice policy before editing the source fields below.
              </p>
            </div>
            <div className="rounded-lg border border-[var(--color-pib-border)] bg-[var(--color-pib-surface-soft)] px-4 py-3 text-sm text-[var(--color-pib-text-muted)]">
              {accessLabel}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div data-testid="organisation-readiness-ready-areas" className="pib-stat-card min-w-0 space-y-2 p-4">
              <p className="text-2xl font-semibold text-[var(--color-pib-text)]">{readyAreas} ready areas</p>
              <p className="text-xs leading-5 text-[var(--color-pib-text-muted)]">Legal, billing, signatory, and accounts readiness.</p>
            </div>
            <div data-testid="organisation-readiness-legal-identity" className="pib-stat-card min-w-0 space-y-2 p-4">
              <p className="truncate text-sm font-semibold text-[var(--color-pib-text)]" title={legalIdentity}>{legalIdentity}</p>
              <p className="text-xs leading-5 text-[var(--color-pib-text-muted)]">Legal identity used on agreements and client records.</p>
            </div>
            <div data-testid="organisation-readiness-billing-contact" className="pib-stat-card min-w-0 space-y-2 p-4">
              <p className="truncate text-sm font-semibold text-[var(--color-pib-text)]" title={billingContact}>{billingContact}</p>
              <p className="text-xs leading-5 text-[var(--color-pib-text-muted)]">Billing destination for accepted proposals and invoices.</p>
            </div>
            <div data-testid="organisation-readiness-agreement-owner" className="pib-stat-card min-w-0 space-y-2 p-4">
              <p className="truncate text-sm font-semibold text-[var(--color-pib-text)]" title={agreementOwner}>{agreementOwner}</p>
              <p className="text-xs leading-5 text-[var(--color-pib-text-muted)]">{invoicePolicy}</p>
            </div>
          </div>
        </div>
      </section>

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

      {/* Timezone — standalone section, separate save */}
      <div className="pib-card space-y-4">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Timezone</p>
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          All scheduled times, reports, and activity timestamps will display in this timezone for your organisation.
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="org-timezone" className="pib-label !mb-0">Organisation timezone</label>
          <select
            id="org-timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            disabled={!canEdit}
            className="pib-input disabled:opacity-60"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>
        </div>
        {tzError && <p className="text-sm text-red-400">{tzError}</p>}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSaveTimezone}
            disabled={tzSaving || !canEdit}
            className="pib-btn-primary disabled:opacity-60"
          >
            {tzSaving ? 'Saving...' : 'Save timezone'}
          </button>
          {tzSaved && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-pib-success,#22c55e)]/10 px-3 py-1 text-xs font-medium text-[var(--color-pib-success,#22c55e)]">
              <span className="material-symbols-outlined text-[14px]">check_circle</span>
              Timezone saved
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
