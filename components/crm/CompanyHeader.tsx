'use client'

import Image from 'next/image'
import { companyAccountOwnerRef, companyAccountOwnerUid, companyHasAccountOwner } from '@/lib/companies/ownership'
import type { Company } from '@/lib/companies/types'
import { SystemLinkBadge } from '@/components/crm/SystemLinkBadge'
import { Icon } from '@/components/studio'

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

const TIER_COLOURS: Record<string, string> = {
  enterprise: 'pib-pill-violet',
  'mid-market': 'pib-pill-blue',
  smb: 'pib-pill-success',
}

const LIFECYCLE_COLOURS: Record<string, string> = {
  lead: 'pib-pill-warn',
  prospect: 'pib-pill-info',
  customer: 'pib-pill-success',
  churned: 'pib-pill-danger',
}

function profileStrength(company: Company): number {
  const checks = [
    company.name,
    company.domain || company.website,
    company.industry,
    company.size || company.employeeCount,
    company.tier,
    company.lifecycleStage,
    company.phone || company.billingEmail || company.accountsContact?.email,
    companyAccountOwnerUid(company),
    company.notes,
    company.logoUrl,
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

function formatCurrency(value: unknown, currency = 'ZAR'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'No revenue tracked'
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency} ${value.toFixed(0)}`
  }
}

function websiteHref(company: Company): string | undefined {
  const raw = company.website || company.domain
  if (!raw) return undefined
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

function readableAccountLabel(value?: string): string | undefined {
  if (!value) return undefined
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase()
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower
    })
    .join(' ')
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CompanyHeaderStats {
  contacts?: number
  deals?: number
  projects?: number
  documents?: number
  activity?: number
}

export interface CompanyHeaderProps {
  company: Company
  onEdit: () => void
  onDelete?: () => void
  deleting?: boolean
  stats?: CompanyHeaderStats
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CompanyHeader({ company, onEdit, onDelete, deleting = false, stats }: CompanyHeaderProps) {
  const tierCls = company.tier
    ? (TIER_COLOURS[company.tier] ?? '')
    : ''
  const lcCls = company.lifecycleStage
    ? (LIFECYCLE_COLOURS[company.lifecycleStage] ?? '')
    : ''
  const tierLabel = readableAccountLabel(company.tier)
  const lifecycleLabel = readableAccountLabel(company.lifecycleStage)
  const am = companyAccountOwnerRef(company)
  const strength = typeof company.healthScore === 'number' ? company.healthScore : profileStrength(company)
  const strengthTone = strength >= 75 ? 'text-emerald-500' : strength >= 45 ? 'text-[var(--color-pib-accent)]' : 'text-[var(--color-error)]'
  const strengthBarTone = strength >= 75 ? 'bg-emerald-500' : strength >= 45 ? 'bg-[var(--color-pib-accent)]' : 'bg-[var(--color-error)]'
  const siteHref = websiteHref(company)
  const missingIdentity = !company.domain && !company.website && !company.legalName
  const missingIndustry = !company.industry
  const missingSize = company.employeeCount == null && !company.size
  const missingAccountManager = !companyHasAccountOwner(company)
  const signals = [
    company.billingEmail || company.accountsContact?.email ? 'Billing contact ready' : undefined,
    company.purchaseOrderRequired ? 'PO required' : undefined,
    company.registrationNumber || company.vatNumber ? 'Legal profile captured' : undefined,
  ].filter(Boolean)
  const statTiles = [
    { label: 'Contacts', value: stats?.contacts ?? 0, icon: 'group' },
    { label: 'Deals', value: stats?.deals ?? 0, icon: 'monetization_on' },
    { label: 'Projects', value: stats?.projects ?? 0, icon: 'folder_managed' },
    { label: 'Docs', value: stats?.documents ?? 0, icon: 'description' },
  ]
  const setupButtonClass =
    'inline-flex items-center gap-1 rounded border border-[var(--color-pib-line)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-pib-text)] transition-colors hover:bg-[var(--color-row-hover)]'

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-[var(--color-pib-line)] px-3 py-2.5" data-module-accent="amber">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          {/* Logo / initials */}
          {company.logoUrl ? (
            <Image
              src={company.logoUrl}
              alt={company.name}
              width={64}
              height={64}
              unoptimized
              className="mt-0.5 h-9 w-9 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded text-xs font-label">
              {initials(company.name)}
            </div>
          )}

          {/* Name + chips */}
          <div className="min-w-0 flex-1">
            <p className="pib-label">Account command center</p>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="truncate text-base leading-tight text-[var(--color-pib-text)]">{company.name}</h1>
              {company.linkedOrgId ? <SystemLinkBadge kind="org" size="md" /> : null}
              {tierLabel && (
                <button
                  type="button"
                  onClick={onEdit}
                  aria-label={`Edit account tier ${tierLabel} for ${company.name}`}
                  className={`pib-pill px-2 py-0.5 text-[10px] transition-opacity hover:opacity-80 ${tierCls}`}
                >
                  {tierLabel}
                </button>
              )}
              {lifecycleLabel && (
                <button
                  type="button"
                  onClick={onEdit}
                  aria-label={`Edit lifecycle stage ${lifecycleLabel} for ${company.name}`}
                  className={`pib-pill px-2 py-0.5 text-[10px] transition-opacity hover:opacity-80 ${lcCls}`}
                >
                  {lifecycleLabel}
                </button>
              )}
              {company.size && (
                <span className="pib-pill px-2 py-0.5 text-[10px]">
                  {company.size}
                </span>
              )}
              {am && (
                <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-pib-text-muted)]">
                  {am.avatarUrl ? (
                    <Image src={am.avatarUrl} alt={am.displayName} width={20} height={20} unoptimized className="h-4 w-4 rounded object-cover" />
                  ) : (
                    <div className="grid h-4 w-4 place-items-center rounded text-[8px] font-label">
                      {initials(am.displayName)}
                    </div>
                  )}
                  <span>{am.displayName}</span>
                </div>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-pib-text-muted)]">
              <span>{company.domain || company.website || company.legalName || 'No domain captured'}</span>
              {missingIdentity && (
                <button
                  type="button"
                  onClick={onEdit}
                  aria-label={`Add domain for ${company.name}`}
                  className={setupButtonClass}
                >
                  <Icon name="add_link" />
                  Add domain
                </button>
              )}
              <span aria-hidden="true">·</span>
              <span>{company.industry || 'Industry not set'}</span>
              {missingIndustry && (
                <button
                  type="button"
                  onClick={onEdit}
                  aria-label={`Add industry for ${company.name}`}
                  className={setupButtonClass}
                >
                  <Icon name="category" />
                  Add industry
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {siteHref && (
            <a
              href={siteHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open website for ${company.name}`}
              className="btn-pib-ghost btn-pib-sm gap-1"
            >
              <Icon name="open_in_new" />
              Website
            </a>
          )}
          {(company.billingEmail || company.accountsContact?.email) && (
            <a
              href={`mailto:${company.billingEmail || company.accountsContact?.email}`}
              aria-label={`Email billing contact for ${company.name}`}
              className="btn-pib-ghost btn-pib-sm gap-1"
            >
              <Icon name="mail" />
              Billing
            </a>
          )}
          {company.phone && (
            <a
              href={`tel:${company.phone}`}
              aria-label={`Call ${company.name}`}
              className="btn-pib-ghost btn-pib-sm gap-1"
            >
              <Icon name="call" />
              Call
            </a>
          )}
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit account profile for ${company.name}`}
            className="btn-pib-primary btn-pib-sm shrink-0 gap-1"
          >
            <Icon name="edit" />
            Edit
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              aria-label={deleting ? `Archiving account ${company.name}` : `Archive account ${company.name}`}
              className="btn-pib-danger btn-pib-sm shrink-0"
            >
              {deleting ? 'Archiving...' : 'Archive'}
            </button>
          )}
        </div>
      </div>

      {missingAccountManager && (
        <div className="border-b border-[var(--color-pib-line)] px-3 py-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="pib-label mb-0 text-[var(--color-pib-accent)]">Account owner missing</p>
              <h2 className="mt-0.5 text-xs text-[var(--color-pib-text)]">Assign account ownership</h2>
              <p className="mt-0.5 max-w-3xl text-xs leading-5 text-[var(--color-pib-text-muted)]">
                No team member owns this account yet. Assign a manager so renewals, escalations, and delivery handoffs stay visible to leadership.
              </p>
            </div>
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Assign account manager for ${company.name}`}
              className="btn-pib-secondary btn-pib-sm shrink-0 gap-1.5"
            >
              <Icon name="person_add" />
              Assign manager
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-3 border-b border-[var(--color-pib-line)] px-3 py-3 sm:grid-cols-2 lg:grid-cols-[minmax(200px,1.2fr)_repeat(4,minmax(0,1fr))]">
        <div className="pib-stat-card">
          <div className="flex items-center justify-between gap-3">
            <p className="pib-label">Profile health</p>
            <span className={`font-mono text-xs ${strengthTone}`}>{strength}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-[var(--color-pib-surface-soft)]">
            <div className={`h-full rounded ${strengthBarTone}`} style={{ width: `${strength}%` }} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">
            <span>{formatCurrency(company.annualRevenue, company.currency)}</span>
            <span aria-hidden="true">·</span>
            <span>{company.employeeCount != null ? `${company.employeeCount.toLocaleString()} people` : 'No size data'}</span>
            {missingSize && (
              <button
                type="button"
                onClick={onEdit}
                aria-label={`Add company size for ${company.name}`}
                className={setupButtonClass}
              >
                <Icon name="groups" />
                Add size
              </button>
            )}
          </div>
        </div>

        {statTiles.map((tile) => (
          <div key={tile.label} className="pib-stat-card">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{tile.label}</span>
              <Icon name={tile.icon} className="text-[var(--color-pib-text-muted)]" />
            </div>
            <p className="mt-1 text-lg leading-none text-[var(--color-pib-text)]">{tile.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
        {signals.length > 0 ? signals.map((signal) => (
          <span key={signal} className="pib-pill h-7 shrink-0 px-2.5 text-[11px]">
            {signal}
          </span>
        )) : (
          <span className="pib-pill pib-pill-warn h-7 shrink-0 px-2.5 text-[11px]">
            Setup gaps: add billing, owner, legal, and relationship details.
          </span>
        )}
        {typeof stats?.activity === 'number' && (
          <span className="pib-pill h-7 shrink-0 px-2.5 text-[11px]">
            {stats.activity} recent activities
          </span>
        )}
      </div>
    </div>
  )
}
