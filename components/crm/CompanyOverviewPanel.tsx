'use client'

import Link from 'next/link'
import type { Company } from '@/lib/companies/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pib-card-section">
      <div className="px-5 py-3 border-b border-[var(--color-pib-line)] bg-white/[0.02]">
        <p className="eyebrow !text-[10px]">{title}</p>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex items-baseline gap-3 py-1">
      <span className="text-[11px] text-[var(--color-pib-text-muted)] w-28 shrink-0">{label}</span>
      <span className="text-sm text-[var(--color-pib-text)]">{value}</span>
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CompanyOverviewPanelProps {
  company: Company
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CompanyOverviewPanel({ company }: CompanyOverviewPanelProps) {
  const addr = company.address
  const social = company.socialProfiles
  const customFields = company.customFields ? Object.entries(company.customFields) : []

  const hasAddress = addr && (addr.street || addr.city || addr.country)
  const hasSocial = social && (social.linkedin || social.twitter || social.facebook || social.instagram)
  const hasContact = company.phone || company.website
  const hasLegal = company.legalName || company.tradingName || company.registrationNumber || company.vatNumber || company.taxNumber
  const billingAddress = company.billingAddress
  const accountsContact = company.accountsContact
  const authorizedSignatory = company.authorizedSignatory
  const hasBillingAddress = billingAddress && (billingAddress.line1 || billingAddress.line2 || billingAddress.city || billingAddress.state || billingAddress.postalCode || billingAddress.country)
  const hasAccountsContact = accountsContact && (accountsContact.name || accountsContact.email || accountsContact.phone || accountsContact.title)
  const hasAuthorizedSignatory = authorizedSignatory && (authorizedSignatory.name || authorizedSignatory.email || authorizedSignatory.phone || authorizedSignatory.title)
  const hasBilling = company.billingEmail || hasBillingAddress || hasAccountsContact || hasAuthorizedSignatory || company.purchaseOrderRequired || company.purchaseOrderNumber || company.invoiceInstructions

  return (
    <div className="space-y-4">
      {/* Legal and billing */}
      {(hasLegal || hasBilling) && (
        <SectionCard title="Legal & Billing">
          {company.legalName && <Field label="Legal name" value={company.legalName} />}
          {company.tradingName && <Field label="Trading name" value={company.tradingName} />}
          {company.registrationNumber && <Field label="Registration" value={company.registrationNumber} />}
          {company.vatNumber && <Field label="VAT" value={company.vatNumber} />}
          {company.taxNumber && <Field label="Tax number" value={company.taxNumber} />}
          {company.billingEmail && <Field label="Billing email" value={company.billingEmail} />}
          {company.billingAddress?.line1 && <Field label="Billing address" value={company.billingAddress.line1} />}
          {company.billingAddress?.line2 && <Field label="Address line 2" value={company.billingAddress.line2} />}
          {company.billingAddress?.city && <Field label="Billing city" value={company.billingAddress.city} />}
          {company.billingAddress?.state && <Field label="Province" value={company.billingAddress.state} />}
          {company.billingAddress?.postalCode && <Field label="Postal code" value={company.billingAddress.postalCode} />}
          {company.billingAddress?.country && <Field label="Country" value={company.billingAddress.country} />}
          {company.accountsContact?.name && <Field label="Accounts" value={company.accountsContact.name} />}
          {company.accountsContact?.email && <Field label="Accounts email" value={company.accountsContact.email} />}
          {company.authorizedSignatory?.name && <Field label="Signatory" value={company.authorizedSignatory.name} />}
          {company.authorizedSignatory?.email && <Field label="Signatory email" value={company.authorizedSignatory.email} />}
          {company.purchaseOrderRequired && <Field label="PO required" value="Yes" />}
          {company.purchaseOrderNumber && <Field label="PO number" value={company.purchaseOrderNumber} />}
          {company.invoiceInstructions && <Field label="Invoice notes" value={company.invoiceInstructions} />}
        </SectionCard>
      )}

      {/* Address */}
      {hasAddress && (
        <SectionCard title="Address">
          {addr?.street && <Field label="Street" value={addr.street} />}
          {addr?.city && <Field label="City" value={addr.city} />}
          {addr?.state && <Field label="State / Province" value={addr.state} />}
          {addr?.country && <Field label="Country" value={addr.country} />}
          {addr?.postalCode && <Field label="Postal code" value={addr.postalCode} />}
        </SectionCard>
      )}

      {/* Contact info */}
      {hasContact && (
        <SectionCard title="Contact">
          {company.phone && <Field label="Phone" value={company.phone} />}
          {company.website && (
            <div className="flex items-baseline gap-3 py-1">
              <span className="text-[11px] text-[var(--color-pib-text-muted)] w-28 shrink-0">Website</span>
              <a
                href={company.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--color-accent-v2)] hover:underline"
              >
                {company.website}
              </a>
            </div>
          )}
        </SectionCard>
      )}

      {/* Social profiles */}
      {hasSocial && (
        <SectionCard title="Social">
          {social?.linkedin && (
            <div className="flex items-center gap-2 py-1">
              <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)]">link</span>
              <a href={social.linkedin} target="_blank" rel="noopener noreferrer"
                className="text-sm text-[var(--color-accent-v2)] hover:underline">
                LinkedIn
              </a>
            </div>
          )}
          {social?.twitter && (
            <div className="flex items-center gap-2 py-1">
              <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)]">link</span>
              <a href={social.twitter} target="_blank" rel="noopener noreferrer"
                className="text-sm text-[var(--color-accent-v2)] hover:underline">
                X / Twitter
              </a>
            </div>
          )}
          {social?.facebook && (
            <div className="flex items-center gap-2 py-1">
              <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)]">link</span>
              <a href={social.facebook} target="_blank" rel="noopener noreferrer"
                className="text-sm text-[var(--color-accent-v2)] hover:underline">
                Facebook
              </a>
            </div>
          )}
          {social?.instagram && (
            <div className="flex items-center gap-2 py-1">
              <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)]">link</span>
              <a href={social.instagram} target="_blank" rel="noopener noreferrer"
                className="text-sm text-[var(--color-accent-v2)] hover:underline">
                Instagram
              </a>
            </div>
          )}
        </SectionCard>
      )}

      {/* Parent company */}
      {company.parentCompanyId && (
        <SectionCard title="Parent Company">
          <Link
            href={`/portal/companies/${company.parentCompanyId}`}
            className="text-sm text-[var(--color-accent-v2)] hover:underline flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[14px]">domain</span>
            View parent company
          </Link>
        </SectionCard>
      )}

      {/* Custom fields */}
      {customFields.length > 0 && (
        <SectionCard title="Custom Fields">
          {customFields.map(([key, val]) => (
            <Field key={key} label={key} value={String(val)} />
          ))}
        </SectionCard>
      )}
    </div>
  )
}
