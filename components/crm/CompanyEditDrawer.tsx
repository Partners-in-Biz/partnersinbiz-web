'use client'

import { useState } from 'react'
import type { Company, CompanySize, CompanyTier, CompanyLifecycleStage } from '@/lib/companies/types'
import type { Currency } from '@/lib/crm/types'
import type { CustomFieldDefinition } from '@/lib/customFields/types'
import { CompanyPicker } from '@/components/crm/CompanyPicker'
import { CustomFieldsSection } from '@/components/crm/CustomFieldsSection'

// ── Form state ────────────────────────────────────────────────────────────────

interface FormState {
  // Identity
  name: string
  domain: string
  website: string
  industry: string
  phone: string
  legalName: string
  tradingName: string
  registrationNumber: string
  vatNumber: string
  taxNumber: string
  billingEmail: string
  billingLine1: string
  billingLine2: string
  billingCity: string
  billingState: string
  billingCountry: string
  billingPostalCode: string
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
  // Address
  street: string
  city: string
  state: string
  country: string
  postalCode: string
  // Size & financials
  size: string
  employeeCount: string
  annualRevenue: string
  currency: string
  tier: string
  // Lifecycle
  lifecycleStage: string
  tags: string
  // Brand
  logoUrl: string
  // Relationships
  parentCompanyId: string
  parentCompanyName: string
  accountManagerUid: string
  // Notes
  notes: string
}

type TextFormField = {
  [K in keyof FormState]: FormState[K] extends string ? K : never
}[keyof FormState]

function companyToForm(company: Partial<Company>): FormState {
  return {
    name: company.name ?? '',
    domain: company.domain ?? '',
    website: company.website ?? '',
    industry: company.industry ?? '',
    phone: company.phone ?? '',
    legalName: company.legalName ?? '',
    tradingName: company.tradingName ?? '',
    registrationNumber: company.registrationNumber ?? '',
    vatNumber: company.vatNumber ?? '',
    taxNumber: company.taxNumber ?? '',
    billingEmail: company.billingEmail ?? '',
    billingLine1: company.billingAddress?.line1 ?? '',
    billingLine2: company.billingAddress?.line2 ?? '',
    billingCity: company.billingAddress?.city ?? '',
    billingState: company.billingAddress?.state ?? '',
    billingCountry: company.billingAddress?.country ?? '',
    billingPostalCode: company.billingAddress?.postalCode ?? '',
    accountsContactName: company.accountsContact?.name ?? '',
    accountsContactTitle: company.accountsContact?.title ?? '',
    accountsContactEmail: company.accountsContact?.email ?? '',
    accountsContactPhone: company.accountsContact?.phone ?? '',
    authorizedSignatoryName: company.authorizedSignatory?.name ?? '',
    authorizedSignatoryTitle: company.authorizedSignatory?.title ?? '',
    authorizedSignatoryEmail: company.authorizedSignatory?.email ?? '',
    authorizedSignatoryPhone: company.authorizedSignatory?.phone ?? '',
    purchaseOrderRequired: company.purchaseOrderRequired ?? false,
    purchaseOrderNumber: company.purchaseOrderNumber ?? '',
    invoiceInstructions: company.invoiceInstructions ?? '',
    street: company.address?.street ?? '',
    city: company.address?.city ?? '',
    state: company.address?.state ?? '',
    country: company.address?.country ?? '',
    postalCode: company.address?.postalCode ?? '',
    size: company.size ?? '',
    employeeCount: company.employeeCount != null ? String(company.employeeCount) : '',
    annualRevenue: company.annualRevenue != null ? String(company.annualRevenue) : '',
    currency: company.currency ?? 'ZAR',
    tier: company.tier ?? '',
    lifecycleStage: company.lifecycleStage ?? '',
    tags: (company.tags ?? []).join(', '),
    logoUrl: company.logoUrl ?? '',
    parentCompanyId: company.parentCompanyId ?? '',
    parentCompanyName: '',
    accountManagerUid: company.accountManagerUid ?? '',
    notes: company.notes ?? '',
  }
}

function formToPartialCompany(f: FormState): Partial<Company> {
  const clean = (value: string) => value.trim() || undefined
  const billingAddress = (f.billingLine1 || f.billingLine2 || f.billingCity || f.billingState || f.billingCountry || f.billingPostalCode)
    ? {
        line1: clean(f.billingLine1),
        line2: clean(f.billingLine2),
        city: clean(f.billingCity),
        state: clean(f.billingState),
        country: clean(f.billingCountry),
        postalCode: clean(f.billingPostalCode),
      }
    : undefined
  const accountsContact = (f.accountsContactName || f.accountsContactTitle || f.accountsContactEmail || f.accountsContactPhone)
    ? {
        name: clean(f.accountsContactName),
        title: clean(f.accountsContactTitle),
        email: clean(f.accountsContactEmail),
        phone: clean(f.accountsContactPhone),
      }
    : undefined
  const authorizedSignatory = (
    f.authorizedSignatoryName ||
    f.authorizedSignatoryTitle ||
    f.authorizedSignatoryEmail ||
    f.authorizedSignatoryPhone
  )
    ? {
        name: clean(f.authorizedSignatoryName),
        title: clean(f.authorizedSignatoryTitle),
        email: clean(f.authorizedSignatoryEmail),
        phone: clean(f.authorizedSignatoryPhone),
      }
    : undefined

  return {
    name: f.name.trim(),
    domain: f.domain.trim() || undefined,
    website: f.website.trim() || undefined,
    industry: f.industry.trim() || undefined,
    phone: clean(f.phone),
    legalName: clean(f.legalName),
    tradingName: clean(f.tradingName),
    registrationNumber: clean(f.registrationNumber),
    vatNumber: clean(f.vatNumber),
    taxNumber: clean(f.taxNumber),
    billingEmail: clean(f.billingEmail),
    billingAddress,
    accountsContact,
    authorizedSignatory,
    purchaseOrderRequired: f.purchaseOrderRequired,
    purchaseOrderNumber: clean(f.purchaseOrderNumber),
    invoiceInstructions: clean(f.invoiceInstructions),
    address: (f.street || f.city || f.state || f.country || f.postalCode)
      ? {
          street: f.street || undefined,
          city: f.city || undefined,
          state: f.state || undefined,
          country: f.country || undefined,
          postalCode: f.postalCode || undefined,
        }
      : undefined,
    size: (f.size as CompanySize) || undefined,
    employeeCount: f.employeeCount ? parseInt(f.employeeCount, 10) : undefined,
    annualRevenue: f.annualRevenue ? parseFloat(f.annualRevenue) : undefined,
    currency: (f.currency as Currency) || undefined,
    tier: (f.tier as CompanyTier) || undefined,
    lifecycleStage: (f.lifecycleStage as CompanyLifecycleStage) || undefined,
    tags: f.tags ? f.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    logoUrl: f.logoUrl.trim() || undefined,
    parentCompanyId: f.parentCompanyId || undefined,
    accountManagerUid: f.accountManagerUid.trim() || undefined,
    notes: f.notes,
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CompanyEditDrawerProps {
  company?: Partial<Company>
  onSave: (data: Partial<Company>) => Promise<void>
  onClose: () => void
  mode: 'create' | 'edit'
  /** Custom-field definitions for the `company` resource — when present, render the dynamic section. */
  customFieldDefinitions?: CustomFieldDefinition[]
}

// ── Field component ───────────────────────────────────────────────────────────

function Field({ label, htmlFor, required, error, children }: {
  label: string
  htmlFor: string
  required?: boolean
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-xs font-label text-[var(--color-pib-text-muted)]">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────

function Section({ title }: { title: string }) {
  return (
    <div className="pt-4 pb-1 border-t border-[var(--color-pib-line)] first:border-0 first:pt-0">
      <p className="eyebrow !text-[10px]">{title}</p>
    </div>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export function CompanyEditDrawer({ company, onSave, onClose, mode, customFieldDefinitions }: CompanyEditDrawerProps) {
  const [form, setForm] = useState<FormState>(() => companyToForm(company ?? {}))
  const [customFields, setCustomFields] = useState<Record<string, unknown>>(
    () => ((company?.customFields as Record<string, unknown>) ?? {}),
  )
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [saving, setSaving] = useState(false)

  function set(field: TextFormField) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((f) => ({ ...f, [field]: e.target.value }))
      if (errors[field]) setErrors((errs) => ({ ...errs, [field]: undefined }))
    }
  }

  function validate(): boolean {
    const newErrors: Partial<Record<keyof FormState, string>> = {}
    if (!form.name.trim()) newErrors.name = 'Name is required'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)
    try {
      const partial = formToPartialCompany(form)
      // Include customFields when definitions exist OR existing record had values
      const hasDefs = (customFieldDefinitions?.length ?? 0) > 0
      const hadExisting = Object.keys((company?.customFields as Record<string, unknown>) ?? {}).length > 0
      if (hasDefs || hadExisting) {
        ;(partial as Partial<Company> & { customFields?: Record<string, unknown> }).customFields = customFields
      }
      await onSave(partial)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const title = mode === 'create' ? 'New Company' : 'Edit Company'

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="relative w-full max-w-lg h-full bg-[var(--color-pib-surface)] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-pib-line)] shrink-0">
          <h2 className="text-base font-semibold text-[var(--color-pib-text)]">{title}</h2>
          <button
            type="button"
            aria-label="Cancel"
            onClick={onClose}
            className="cursor-pointer text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Scrollable form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Identity */}
          <Section title="Identity" />
          <Field label="Company Name" htmlFor="co-name" required error={errors.name}>
            <input
              id="co-name"
              type="text"
              value={form.name}
              onChange={set('name')}
              className="pib-input w-full"
              placeholder="ACME Corp"
            />
          </Field>
          <Field label="Domain" htmlFor="co-domain">
            <input
              id="co-domain"
              type="text"
              value={form.domain}
              onChange={set('domain')}
              className="pib-input w-full"
              placeholder="acme.com"
            />
          </Field>
          <Field label="Website" htmlFor="co-website">
            <input
              id="co-website"
              type="url"
              value={form.website}
              onChange={set('website')}
              className="pib-input w-full"
              placeholder="https://acme.com"
            />
          </Field>
          <Field label="Industry" htmlFor="co-industry">
            <input
              id="co-industry"
              type="text"
              value={form.industry}
              onChange={set('industry')}
              className="pib-input w-full"
              placeholder="SaaS"
            />
          </Field>
          <Field label="Phone" htmlFor="co-phone">
            <input id="co-phone" type="text" value={form.phone} onChange={set('phone')} className="pib-input w-full" placeholder="+27 21 000 0000" />
          </Field>

          {/* Legal & billing */}
          <Section title="Legal & Billing" />
          <Field label="Legal Name" htmlFor="co-legal-name">
            <input id="co-legal-name" type="text" value={form.legalName} onChange={set('legalName')} className="pib-input w-full" placeholder="ACME (Pty) Ltd" />
          </Field>
          <Field label="Trading Name" htmlFor="co-trading-name">
            <input id="co-trading-name" type="text" value={form.tradingName} onChange={set('tradingName')} className="pib-input w-full" placeholder="ACME" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Registration Number" htmlFor="co-registration-number">
              <input id="co-registration-number" type="text" value={form.registrationNumber} onChange={set('registrationNumber')} className="pib-input w-full" placeholder="2020/000000/07" />
            </Field>
            <Field label="VAT Number" htmlFor="co-vat-number">
              <input id="co-vat-number" type="text" value={form.vatNumber} onChange={set('vatNumber')} className="pib-input w-full" placeholder="4000000000" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tax Number" htmlFor="co-tax-number">
              <input id="co-tax-number" type="text" value={form.taxNumber} onChange={set('taxNumber')} className="pib-input w-full" />
            </Field>
            <Field label="Billing Email" htmlFor="co-billing-email">
              <input id="co-billing-email" type="email" value={form.billingEmail} onChange={set('billingEmail')} className="pib-input w-full" placeholder="accounts@company.com" />
            </Field>
          </div>
          <Field label="Billing Street Address" htmlFor="co-billing-line1">
            <input id="co-billing-line1" type="text" value={form.billingLine1} onChange={set('billingLine1')} className="pib-input w-full" />
          </Field>
          <Field label="Billing Address Line 2" htmlFor="co-billing-line2">
            <input id="co-billing-line2" type="text" value={form.billingLine2} onChange={set('billingLine2')} className="pib-input w-full" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Billing City" htmlFor="co-billing-city">
              <input id="co-billing-city" type="text" value={form.billingCity} onChange={set('billingCity')} className="pib-input w-full" />
            </Field>
            <Field label="Billing State / Province" htmlFor="co-billing-state">
              <input id="co-billing-state" type="text" value={form.billingState} onChange={set('billingState')} className="pib-input w-full" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Billing Postal Code" htmlFor="co-billing-postal-code">
              <input id="co-billing-postal-code" type="text" value={form.billingPostalCode} onChange={set('billingPostalCode')} className="pib-input w-full" />
            </Field>
            <Field label="Billing Country" htmlFor="co-billing-country">
              <input id="co-billing-country" type="text" value={form.billingCountry} onChange={set('billingCountry')} className="pib-input w-full" />
            </Field>
          </div>

          {/* Agreement contacts */}
          <Section title="Agreement Contacts" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Accounts Contact Name" htmlFor="co-accounts-name">
              <input id="co-accounts-name" type="text" value={form.accountsContactName} onChange={set('accountsContactName')} className="pib-input w-full" />
            </Field>
            <Field label="Accounts Contact Title" htmlFor="co-accounts-title">
              <input id="co-accounts-title" type="text" value={form.accountsContactTitle} onChange={set('accountsContactTitle')} className="pib-input w-full" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Accounts Contact Email" htmlFor="co-accounts-email">
              <input id="co-accounts-email" type="email" value={form.accountsContactEmail} onChange={set('accountsContactEmail')} className="pib-input w-full" />
            </Field>
            <Field label="Accounts Contact Phone" htmlFor="co-accounts-phone">
              <input id="co-accounts-phone" type="text" value={form.accountsContactPhone} onChange={set('accountsContactPhone')} className="pib-input w-full" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Authorised Signatory Name" htmlFor="co-signatory-name">
              <input id="co-signatory-name" type="text" value={form.authorizedSignatoryName} onChange={set('authorizedSignatoryName')} className="pib-input w-full" />
            </Field>
            <Field label="Authorised Signatory Title" htmlFor="co-signatory-title">
              <input id="co-signatory-title" type="text" value={form.authorizedSignatoryTitle} onChange={set('authorizedSignatoryTitle')} className="pib-input w-full" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Authorised Signatory Email" htmlFor="co-signatory-email">
              <input id="co-signatory-email" type="email" value={form.authorizedSignatoryEmail} onChange={set('authorizedSignatoryEmail')} className="pib-input w-full" />
            </Field>
            <Field label="Authorised Signatory Phone" htmlFor="co-signatory-phone">
              <input id="co-signatory-phone" type="text" value={form.authorizedSignatoryPhone} onChange={set('authorizedSignatoryPhone')} className="pib-input w-full" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--color-pib-text-muted)]">
            <input
              type="checkbox"
              checked={form.purchaseOrderRequired}
              onChange={(e) => setForm((f) => ({ ...f, purchaseOrderRequired: e.target.checked }))}
              className="h-4 w-4 rounded border-outline text-primary"
            />
            Purchase order required
          </label>
          <Field label="Purchase Order Number" htmlFor="co-po-number">
            <input id="co-po-number" type="text" value={form.purchaseOrderNumber} onChange={set('purchaseOrderNumber')} className="pib-input w-full" />
          </Field>
          <Field label="Invoice Instructions" htmlFor="co-invoice-instructions">
            <textarea id="co-invoice-instructions" value={form.invoiceInstructions} onChange={set('invoiceInstructions')} rows={3} className="pib-input w-full resize-none" />
          </Field>

          {/* Address */}
          <Section title="Address" />
          <Field label="Street" htmlFor="co-street">
            <input id="co-street" type="text" value={form.street} onChange={set('street')} className="pib-input w-full" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="City" htmlFor="co-city">
              <input id="co-city" type="text" value={form.city} onChange={set('city')} className="pib-input w-full" />
            </Field>
            <Field label="State / Province" htmlFor="co-state">
              <input id="co-state" type="text" value={form.state} onChange={set('state')} className="pib-input w-full" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Country" htmlFor="co-country">
              <input id="co-country" type="text" value={form.country} onChange={set('country')} className="pib-input w-full" />
            </Field>
            <Field label="Postal Code" htmlFor="co-postal">
              <input id="co-postal" type="text" value={form.postalCode} onChange={set('postalCode')} className="pib-input w-full" />
            </Field>
          </div>

          {/* Size & financials */}
          <Section title="Size & Financials" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Size" htmlFor="co-size">
              <select id="co-size" value={form.size} onChange={set('size')} className="pib-input w-full">
                <option value="">—</option>
                {(['1-10', '11-50', '51-200', '201-1000', '1000+'] as CompanySize[]).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Employee Count" htmlFor="co-emp">
              <input id="co-emp" type="number" min={0} value={form.employeeCount} onChange={set('employeeCount')} className="pib-input w-full" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Annual Revenue" htmlFor="co-rev">
              <input id="co-rev" type="number" min={0} value={form.annualRevenue} onChange={set('annualRevenue')} className="pib-input w-full" />
            </Field>
            <Field label="Currency" htmlFor="co-currency">
              <input id="co-currency" type="text" value={form.currency} onChange={set('currency')} className="pib-input w-full" placeholder="ZAR" />
            </Field>
          </div>
          <Field label="Tier" htmlFor="co-tier">
            <select id="co-tier" value={form.tier} onChange={set('tier')} className="pib-input w-full">
              <option value="">—</option>
              {(['enterprise', 'mid-market', 'smb'] as CompanyTier[]).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>

          {/* Lifecycle */}
          <Section title="Lifecycle & Tags" />
          <Field label="Lifecycle Stage" htmlFor="co-lifecycle">
            <select id="co-lifecycle" value={form.lifecycleStage} onChange={set('lifecycleStage')} className="pib-input w-full">
              <option value="">—</option>
              {(['lead', 'prospect', 'customer', 'churned'] as CompanyLifecycleStage[]).map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="Tags" htmlFor="co-tags">
            <input
              id="co-tags"
              type="text"
              value={form.tags}
              onChange={set('tags')}
              placeholder="vip, tech, priority"
              className="pib-input w-full"
            />
          </Field>

          {/* Brand */}
          <Section title="Brand" />
          <Field label="Logo URL" htmlFor="co-logo">
            <input
              id="co-logo"
              type="url"
              value={form.logoUrl}
              onChange={set('logoUrl')}
              placeholder="https://…"
              className="pib-input w-full"
            />
          </Field>

          {/* Relationships */}
          <Section title="Relationships" />
          <Field label="Parent Company" htmlFor="co-parent">
            <CompanyPicker
              currentCompanyId={form.parentCompanyId || undefined}
              currentCompanyName={form.parentCompanyName || undefined}
              onChange={({ companyId, companyName }) => {
                setForm((f) => ({
                  ...f,
                  parentCompanyId: companyId ?? '',
                  parentCompanyName: companyName ?? '',
                }))
              }}
            />
          </Field>
          <Field label="Account Manager UID" htmlFor="co-am">
            <input
              id="co-am"
              type="text"
              value={form.accountManagerUid}
              onChange={set('accountManagerUid')}
              placeholder="uid of team member"
              className="pib-input w-full"
            />
          </Field>

          {/* Custom fields (only when workspace has defined any) */}
          {customFieldDefinitions && customFieldDefinitions.length > 0 && (
            <>
              <Section title="Custom Fields" />
              <CustomFieldsSection
                definitions={customFieldDefinitions}
                values={customFields}
                mode="edit"
                onChange={setCustomFields}
              />
            </>
          )}

          {/* Notes */}
          <Section title="Notes" />
          <Field label="Notes" htmlFor="co-notes">
            <textarea
              id="co-notes"
              value={form.notes}
              onChange={set('notes')}
              rows={4}
              className="pib-input w-full resize-none"
              placeholder="Internal notes about this company…"
            />
          </Field>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--color-pib-line)] shrink-0">
          <button
            type="button"
            onClick={onClose}
            aria-label="Cancel"
            className="cursor-pointer btn-pib-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            form=""
            onClick={handleSubmit}
            disabled={saving}
            aria-label="Save company"
            className="cursor-pointer btn-pib-accent disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {saving ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                Saving…
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
