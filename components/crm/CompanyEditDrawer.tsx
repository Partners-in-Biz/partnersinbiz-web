'use client'

import { cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from 'react'
import type { Company, CompanySize, CompanyTier, CompanyLifecycleStage } from '@/lib/companies/types'
import type { Currency } from '@/lib/crm/types'
import type { CustomFieldDefinition } from '@/lib/customFields/types'
import type { PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import { CompanyPicker } from '@/components/crm/CompanyPicker'
import { CustomFieldsSection } from '@/components/crm/CustomFieldsSection'
import { ProfileLinksFields } from '@/components/crm/ProfileLinksFields'
import {
  companySocialFromValues,
  sanitizeOtherLinks,
  type ProfileLink,
  type ProfileLinkFieldValues,
} from '@/lib/crm/profileLinks'

export interface CompanyTeamMember {
  uid: string
  firstName?: string
  lastName?: string
  displayName?: string
  jobTitle?: string
}

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
    parentCompanyName: company.parentCompanyName ?? '',
    accountManagerUid: company.accountManagerUid ?? company.accountManagerRef?.uid ?? '',
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
    parentCompanyName: f.parentCompanyId ? clean(f.parentCompanyName) : undefined,
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
  orgScope?: PortalOrgRouteScope
  teamMembers?: CompanyTeamMember[]
  /** Custom-field definitions for the `company` resource — when present, render the dynamic section. */
  customFieldDefinitions?: CustomFieldDefinition[]
}

// ── Field component ───────────────────────────────────────────────────────────

function Field({ label, htmlFor, required, error, children }: {
  label: string
  htmlFor: string
  required?: boolean
  error?: string
  children: ReactNode
}) {
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string; 'aria-label'?: string }>, {
        id: (children as ReactElement<{ id?: string }>).props.id ?? htmlFor,
        'aria-label': (children as ReactElement<{ 'aria-label'?: string }>).props['aria-label'] ?? label,
      })
    : children

  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-[11px] font-label text-[var(--color-pib-text-muted)]">
        {label}{required && <span className="text-[var(--st-danger)] ml-0.5">*</span>}
      </label>
      {control}
      {error && <p className="text-xs text-[var(--st-danger)]">{error}</p>}
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────

function Section({ title }: { title: string }) {
  return (
    <div className="pt-3 pb-1 border-t border-[var(--color-card-border)] first:border-0 first:pt-0">
      <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">{title}</p>
    </div>
  )
}

function teamMemberName(member: CompanyTeamMember): string {
  return member.displayName?.trim()
    || [member.firstName, member.lastName].map((part) => part?.trim()).filter(Boolean).join(' ')
    || member.uid
}

function teamMemberOptionLabel(member: CompanyTeamMember): string {
  const name = teamMemberName(member)
  return member.jobTitle?.trim() ? `${name} (${member.jobTitle.trim()})` : name
}

// ── Public component ──────────────────────────────────────────────────────────

export function CompanyEditDrawer({ company, onSave, onClose, mode, orgScope, teamMembers = [], customFieldDefinitions }: CompanyEditDrawerProps) {
  const [form, setForm] = useState<FormState>(() => companyToForm(company ?? {}))
  const [profileLinks, setProfileLinks] = useState<ProfileLinkFieldValues>(() => ({
    linkedin: company?.socialProfiles?.linkedin ?? '',
    twitter: company?.socialProfiles?.twitter ?? '',
    github: company?.socialProfiles?.github ?? '',
    facebook: company?.socialProfiles?.facebook ?? '',
    instagram: company?.socialProfiles?.instagram ?? '',
    youtube: company?.socialProfiles?.youtube ?? '',
  }))
  const [otherLinks, setOtherLinks] = useState<ProfileLink[]>(() => sanitizeOtherLinks(company?.otherLinks) ?? [])
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
      partial.socialProfiles = companySocialFromValues(profileLinks)
      partial.otherLinks = sanitizeOtherLinks(otherLinks) ?? []
      const hadAccountManager = Boolean(company?.accountManagerUid || company?.accountManagerRef?.uid)
      if (mode === 'edit' && hadAccountManager && !form.accountManagerUid.trim()) {
        partial.accountManagerUid = ''
      }
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
  const knownManagerIds = new Set(teamMembers.map((member) => member.uid))
  const unresolvedManagerUid = form.accountManagerUid && !knownManagerIds.has(form.accountManagerUid)

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="relative flex h-full w-full max-w-lg flex-col overflow-hidden border-l border-[var(--color-card-border)] bg-[var(--color-card)]">
        {/* Header */}
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--color-card-border)] px-4">
          <h2 className="text-sm text-[var(--color-pib-text)]">{title}</h2>
          <button
            type="button"
            aria-label={`Close ${title} drawer`}
            onClick={onClose}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-md text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
          >
            <span className="material-symbols-outlined text-[19px]">close</span>
          </button>
        </div>

        {/* Scrollable form */}
        <form onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* Identity */}
          <Section title="Identity" />
          <Field label="Company Name" htmlFor="co-name" required error={errors.name}>
            <input aria-label="Company Name"
              id="co-name"
              type="text"
              value={form.name}
              onChange={set('name')}
              className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25"
              placeholder="ACME Corp"
            />
          </Field>
          <Field label="Domain" htmlFor="co-domain">
            <input aria-label="Domain"
              id="co-domain"
              type="text"
              value={form.domain}
              onChange={set('domain')}
              className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25"
              placeholder="acme.com"
            />
          </Field>
          <Field label="Website" htmlFor="co-website">
            <input aria-label="Website"
              id="co-website"
              type="url"
              value={form.website}
              onChange={set('website')}
              className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25"
              placeholder="https://acme.com"
            />
          </Field>
          <Section title="Links & profiles" />
          <ProfileLinksFields
            idPrefix="co-profile"
            includeWebsite={false}
            values={profileLinks}
            otherLinks={otherLinks}
            onChange={setProfileLinks}
            onOtherLinksChange={setOtherLinks}
          />
          <Field label="Industry" htmlFor="co-industry">
            <input aria-label="Industry"
              id="co-industry"
              type="text"
              value={form.industry}
              onChange={set('industry')}
              className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25"
              placeholder="SaaS"
            />
          </Field>
          <Field label="Phone" htmlFor="co-phone">
            <input aria-label="Phone" id="co-phone" type="text" value={form.phone} onChange={set('phone')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" placeholder="+27 21 000 0000" />
          </Field>

          {/* Legal & billing */}
          <Section title="Legal & Billing" />
          <Field label="Legal Name" htmlFor="co-legal-name">
            <input aria-label="Legal Name" id="co-legal-name" type="text" value={form.legalName} onChange={set('legalName')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" placeholder="ACME (Pty) Ltd" />
          </Field>
          <Field label="Trading Name" htmlFor="co-trading-name">
            <input aria-label="Trading Name" id="co-trading-name" type="text" value={form.tradingName} onChange={set('tradingName')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" placeholder="ACME" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Registration Number" htmlFor="co-registration-number">
              <input aria-label="Registration Number" id="co-registration-number" type="text" value={form.registrationNumber} onChange={set('registrationNumber')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" placeholder="2020/000000/07" />
            </Field>
            <Field label="VAT Number" htmlFor="co-vat-number">
              <input aria-label="VAT Number" id="co-vat-number" type="text" value={form.vatNumber} onChange={set('vatNumber')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" placeholder="4000000000" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Tax Number" htmlFor="co-tax-number">
              <input aria-label="Tax Number" id="co-tax-number" type="text" value={form.taxNumber} onChange={set('taxNumber')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
            </Field>
            <Field label="Billing Email" htmlFor="co-billing-email">
              <input aria-label="Billing Email" id="co-billing-email" type="email" value={form.billingEmail} onChange={set('billingEmail')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" placeholder="accounts@company.com" />
            </Field>
          </div>
          <Field label="Billing Street Address" htmlFor="co-billing-line1">
            <input aria-label="Billing Street Address" id="co-billing-line1" type="text" value={form.billingLine1} onChange={set('billingLine1')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
          </Field>
          <Field label="Billing Address Line 2" htmlFor="co-billing-line2">
            <input aria-label="Billing Address Line 2" id="co-billing-line2" type="text" value={form.billingLine2} onChange={set('billingLine2')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Billing City" htmlFor="co-billing-city">
              <input aria-label="Billing City" id="co-billing-city" type="text" value={form.billingCity} onChange={set('billingCity')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
            </Field>
            <Field label="Billing State / Province" htmlFor="co-billing-state">
              <input aria-label="Billing State / Province" id="co-billing-state" type="text" value={form.billingState} onChange={set('billingState')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Billing Postal Code" htmlFor="co-billing-postal-code">
              <input aria-label="Billing Postal Code" id="co-billing-postal-code" type="text" value={form.billingPostalCode} onChange={set('billingPostalCode')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
            </Field>
            <Field label="Billing Country" htmlFor="co-billing-country">
              <input aria-label="Billing Country" id="co-billing-country" type="text" value={form.billingCountry} onChange={set('billingCountry')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
            </Field>
          </div>

          {/* Agreement contacts */}
          <Section title="Agreement Contacts" />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Accounts Contact Name" htmlFor="co-accounts-name">
              <input aria-label="Accounts Contact Name" id="co-accounts-name" type="text" value={form.accountsContactName} onChange={set('accountsContactName')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
            </Field>
            <Field label="Accounts Contact Title" htmlFor="co-accounts-title">
              <input aria-label="Accounts Contact Title" id="co-accounts-title" type="text" value={form.accountsContactTitle} onChange={set('accountsContactTitle')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Accounts Contact Email" htmlFor="co-accounts-email">
              <input aria-label="Accounts Contact Email" id="co-accounts-email" type="email" value={form.accountsContactEmail} onChange={set('accountsContactEmail')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
            </Field>
            <Field label="Accounts Contact Phone" htmlFor="co-accounts-phone">
              <input aria-label="Accounts Contact Phone" id="co-accounts-phone" type="text" value={form.accountsContactPhone} onChange={set('accountsContactPhone')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Authorised Signatory Name" htmlFor="co-signatory-name">
              <input aria-label="Authorised Signatory Name" id="co-signatory-name" type="text" value={form.authorizedSignatoryName} onChange={set('authorizedSignatoryName')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
            </Field>
            <Field label="Authorised Signatory Title" htmlFor="co-signatory-title">
              <input aria-label="Authorised Signatory Title" id="co-signatory-title" type="text" value={form.authorizedSignatoryTitle} onChange={set('authorizedSignatoryTitle')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Authorised Signatory Email" htmlFor="co-signatory-email">
              <input aria-label="Authorised Signatory Email" id="co-signatory-email" type="email" value={form.authorizedSignatoryEmail} onChange={set('authorizedSignatoryEmail')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
            </Field>
            <Field label="Authorised Signatory Phone" htmlFor="co-signatory-phone">
              <input aria-label="Authorised Signatory Phone" id="co-signatory-phone" type="text" value={form.authorizedSignatoryPhone} onChange={set('authorizedSignatoryPhone')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--color-pib-text-muted)]">
            <input
              type="checkbox"
              checked={form.purchaseOrderRequired}
              onChange={(e) => setForm((f) => ({ ...f, purchaseOrderRequired: e.target.checked }))}
              className="h-4 w-4 rounded accent-[var(--color-accent-v2)]"
            />
            Purchase order required
          </label>
          <Field label="Purchase Order Number" htmlFor="co-po-number">
            <input aria-label="Purchase Order Number" id="co-po-number" type="text" value={form.purchaseOrderNumber} onChange={set('purchaseOrderNumber')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
          </Field>
          <Field label="Invoice Instructions" htmlFor="co-invoice-instructions">
            <textarea aria-label="Invoice Instructions" id="co-invoice-instructions" value={form.invoiceInstructions} onChange={set('invoiceInstructions')} rows={3} className="w-full rounded-md border border-[var(--color-card-border)] bg-transparent p-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25 resize-none" />
          </Field>

          {/* Address */}
          <Section title="Address" />
          <Field label="Street" htmlFor="co-street">
            <input aria-label="Street" id="co-street" type="text" value={form.street} onChange={set('street')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="City" htmlFor="co-city">
              <input aria-label="City" id="co-city" type="text" value={form.city} onChange={set('city')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
            </Field>
            <Field label="State / Province" htmlFor="co-state">
              <input aria-label="State / Province" id="co-state" type="text" value={form.state} onChange={set('state')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Country" htmlFor="co-country">
              <input aria-label="Country" id="co-country" type="text" value={form.country} onChange={set('country')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
            </Field>
            <Field label="Postal Code" htmlFor="co-postal">
              <input aria-label="Postal Code" id="co-postal" type="text" value={form.postalCode} onChange={set('postalCode')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
            </Field>
          </div>

          {/* Size & financials */}
          <Section title="Size & Financials" />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Size" htmlFor="co-size">
              <select aria-label="Size" id="co-size" value={form.size} onChange={set('size')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25">
                <option value="">Select company size</option>
                {(['1-10', '11-50', '51-200', '201-1000', '1000+'] as CompanySize[]).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Employee Count" htmlFor="co-emp">
              <input aria-label="Employee Count" id="co-emp" type="number" min={0} value={form.employeeCount} onChange={set('employeeCount')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Annual Revenue" htmlFor="co-rev">
              <input aria-label="Annual Revenue" id="co-rev" type="number" min={0} value={form.annualRevenue} onChange={set('annualRevenue')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" />
            </Field>
            <Field label="Currency" htmlFor="co-currency">
              <input aria-label="Currency" id="co-currency" type="text" value={form.currency} onChange={set('currency')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25" placeholder="ZAR" />
            </Field>
          </div>
          <Field label="Tier" htmlFor="co-tier">
            <select aria-label="Tier" id="co-tier" value={form.tier} onChange={set('tier')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25">
              <option value="">Select account tier</option>
              {(['enterprise', 'mid-market', 'smb'] as CompanyTier[]).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>

          {/* Lifecycle */}
          <Section title="Lifecycle & Tags" />
          <Field label="Lifecycle Stage" htmlFor="co-lifecycle">
            <select aria-label="Lifecycle Stage" id="co-lifecycle" value={form.lifecycleStage} onChange={set('lifecycleStage')} className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25">
              <option value="">Select lifecycle stage</option>
              {(['lead', 'prospect', 'customer', 'churned'] as CompanyLifecycleStage[]).map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="Tags" htmlFor="co-tags">
            <input aria-label="Tags"
              id="co-tags"
              type="text"
              value={form.tags}
              onChange={set('tags')}
              placeholder="vip, tech, priority"
              className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25"
            />
          </Field>

          {/* Brand */}
          <Section title="Brand" />
          <Field label="Logo URL" htmlFor="co-logo">
            <input aria-label="Logo URL"
              id="co-logo"
              type="url"
              value={form.logoUrl}
              onChange={set('logoUrl')}
              placeholder="https://…"
              className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25"
            />
          </Field>

          {/* Relationships */}
          <Section title="Relationships" />
          <Field label="Parent Company" htmlFor="co-parent">
            <CompanyPicker
              currentCompanyId={form.parentCompanyId || undefined}
              currentCompanyName={form.parentCompanyName || undefined}
              orgScope={orgScope}
              onChange={({ companyId, companyName }) => {
                setForm((f) => ({
                  ...f,
                  parentCompanyId: companyId ?? '',
                  parentCompanyName: companyName ?? '',
                }))
              }}
            />
          </Field>
          <Field label={teamMembers.length > 0 ? 'Account manager' : 'Account Manager UID'} htmlFor="co-am">
            {teamMembers.length > 0 ? (
              <select
                id="co-am"
                aria-label="Account manager"
                value={form.accountManagerUid}
                onChange={set('accountManagerUid')}
                className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25"
              >
                <option value="">Select account manager</option>
                {unresolvedManagerUid && (
                  <option value={form.accountManagerUid}>Account manager identity missing</option>
                )}
                {teamMembers.map((member) => (
                  <option key={member.uid} value={member.uid}>
                    {teamMemberOptionLabel(member)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="co-am"
                type="text"
                aria-label="Account Manager UID"
                value={form.accountManagerUid}
                onChange={set('accountManagerUid')}
                placeholder="uid of team member"
                className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25"
              />
            )}
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
              aria-label="Notes"
              value={form.notes}
              onChange={set('notes')}
              rows={4}
              className="w-full rounded-md border border-[var(--color-card-border)] bg-transparent p-2.5 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none focus:border-white/25 resize-none"
              placeholder="Internal notes about this company…"
            />
          </Field>
        </form>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-[var(--color-card-border)] px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            aria-label={`Cancel ${title}`}
            className="flex h-8 cursor-pointer items-center rounded-md border border-[var(--color-card-border)] px-3 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            form=""
            onClick={handleSubmit}
            disabled={saving}
            aria-label="Save company"
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
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
