'use client'

import Image from 'next/image'
import { companyAccountOwnerRef, companyAccountOwnerUid, companyHasAccountOwner } from '@/lib/companies/ownership'
import type { Company } from '@/lib/companies/types'

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
  enterprise: 'bg-purple-500/20 text-purple-300',
  'mid-market': 'bg-blue-500/20 text-blue-300',
  smb: 'bg-green-500/20 text-green-300',
}

const LIFECYCLE_COLOURS: Record<string, string> = {
  lead: 'bg-yellow-500/20 text-yellow-300',
  prospect: 'bg-sky-500/20 text-sky-300',
  customer: 'bg-green-500/20 text-green-300',
  churned: 'bg-red-500/20 text-red-300',
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
    ? (TIER_COLOURS[company.tier] ?? 'bg-[var(--color-surface-container)] text-on-surface-variant')
    : ''
  const lcCls = company.lifecycleStage
    ? (LIFECYCLE_COLOURS[company.lifecycleStage] ?? 'bg-[var(--color-surface-container)] text-on-surface-variant')
    : ''
  const tierLabel = readableAccountLabel(company.tier)
  const lifecycleLabel = readableAccountLabel(company.lifecycleStage)
  const am = companyAccountOwnerRef(company)
  const strength = typeof company.healthScore === 'number' ? company.healthScore : profileStrength(company)
  const strengthColor = strength >= 75 ? '#4ade80' : strength >= 45 ? '#facc15' : '#f87171'
  const siteHref = websiteHref(company)
  const missingIdentity = !company.domain && !company.website && !company.legalName
  const missingIndustry = !company.industry
  const missingSize = company.employeeCount == null && !company.size
  const missingAccountManager = !companyHasAccountOwner(company)
  const signals = [
    company.linkedOrgId ? 'Client org linked' : undefined,
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
    'inline-flex items-center gap-1 rounded-md border border-[var(--color-card-border)] px-1.5 py-0.5 text-[10px] font-medium text-on-surface transition-colors hover:bg-white/[0.05]'

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-[var(--color-card-border)] px-3 py-2">
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
            <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--color-surface-container)] text-xs font-label text-on-surface-variant">
              {initials(company.name)}
            </div>
          )}

          {/* Name + chips */}
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Account command center</p>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="truncate text-base font-semibold leading-tight text-on-surface">{company.name}</h1>
              {tierLabel && (
                <button
                  type="button"
                  onClick={onEdit}
                  aria-label={`Edit account tier ${tierLabel} for ${company.name}`}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-label uppercase tracking-wide transition-opacity hover:opacity-80 ${tierCls}`}
                >
                  {tierLabel}
                </button>
              )}
              {lifecycleLabel && (
                <button
                  type="button"
                  onClick={onEdit}
                  aria-label={`Edit lifecycle stage ${lifecycleLabel} for ${company.name}`}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-label uppercase tracking-wide transition-opacity hover:opacity-80 ${lcCls}`}
                >
                  {lifecycleLabel}
                </button>
              )}
              {company.size && (
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-label uppercase tracking-wide text-on-surface-variant">
                  {company.size}
                </span>
              )}
              {am && (
                <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant">
                  {am.avatarUrl ? (
                    <Image src={am.avatarUrl} alt={am.displayName} width={20} height={20} unoptimized className="h-4 w-4 rounded-full object-cover" />
                  ) : (
                    <div className="grid h-4 w-4 place-items-center rounded-full bg-[var(--color-surface-container)] text-[8px] font-label text-on-surface-variant">
                      {initials(am.displayName)}
                    </div>
                  )}
                  <span>{am.displayName}</span>
                </div>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-on-surface-variant">
              <span>{company.domain || company.website || company.legalName || 'No domain captured'}</span>
              {missingIdentity && (
                <button
                  type="button"
                  onClick={onEdit}
                  aria-label={`Add domain for ${company.name}`}
                  className={setupButtonClass}
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">add_link</span>
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
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">category</span>
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
              className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">open_in_new</span>
              Website
            </a>
          )}
          {(company.billingEmail || company.accountsContact?.email) && (
            <a
              href={`mailto:${company.billingEmail || company.accountsContact?.email}`}
              aria-label={`Email billing contact for ${company.name}`}
              className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">mail</span>
              Billing
            </a>
          )}
          {company.phone && (
            <a
              href={`tel:${company.phone}`}
              aria-label={`Call ${company.name}`}
              className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">call</span>
              Call
            </a>
          )}
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit account profile for ${company.name}`}
            className="flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-[var(--color-card-border)] bg-primary/10 px-2.5 text-xs font-medium text-primary transition hover:bg-primary/15"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">edit</span>
            Edit
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              aria-label={deleting ? `Archiving account ${company.name}` : `Archive account ${company.name}`}
              className="flex h-8 shrink-0 items-center rounded-md border border-red-400/30 bg-red-500/10 px-2.5 text-xs text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleting ? 'Archiving...' : 'Archive'}
            </button>
          )}
        </div>
      </div>

      {missingAccountManager && (
        <div className="border-b border-amber-400/30 bg-amber-400/10 px-3 py-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-label uppercase tracking-[0.22em] text-amber-200">Account owner missing</p>
              <h2 className="mt-0.5 text-xs font-semibold text-on-surface">Assign account ownership</h2>
              <p className="mt-0.5 max-w-3xl text-xs leading-5 text-on-surface-variant">
                No team member owns this account yet. Assign a manager so renewals, escalations, and delivery handoffs stay visible to leadership.
              </p>
            </div>
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Assign account manager for ${company.name}`}
              className="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2.5 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">person_add</span>
              Assign manager
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-2 border-b border-[var(--color-card-border)] px-3 py-2 sm:grid-cols-2 lg:grid-cols-[minmax(200px,1.2fr)_repeat(4,minmax(0,1fr))]">
        <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Profile health</p>
            <span className="font-mono text-xs" style={{ color: strengthColor }}>{strength}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full" style={{ width: `${strength}%`, background: strengthColor }} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-on-surface-variant">
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
                <span aria-hidden="true" className="material-symbols-outlined text-[14px]">groups</span>
                Add size
              </button>
            )}
          </div>
        </div>

        {statTiles.map((tile) => (
          <div key={tile.label} className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] leading-4 text-on-surface-variant">{tile.label}</span>
              <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-on-surface-variant">{tile.icon}</span>
            </div>
            <p className="mt-1 text-lg font-semibold leading-none text-on-surface">{tile.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
        {signals.length > 0 ? signals.map((signal) => (
          <span key={signal} className="flex h-7 shrink-0 items-center rounded-full border border-[var(--color-card-border)] px-2.5 text-[11px] text-on-surface-variant">
            {signal}
          </span>
        )) : (
          <span className="flex h-7 shrink-0 items-center rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 text-[11px] text-amber-200">
            Setup gaps: add billing, owner, legal, and relationship details.
          </span>
        )}
        {typeof stats?.activity === 'number' && (
          <span className="flex h-7 shrink-0 items-center rounded-full border border-[var(--color-card-border)] px-2.5 text-[11px] text-on-surface-variant">
            {stats.activity} recent activities
          </span>
        )}
      </div>
    </div>
  )
}
