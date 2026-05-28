'use client'

import Image from 'next/image'
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
    company.accountManagerUid || company.accountManagerRef?.uid,
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
  const am = company.accountManagerRef
  const strength = typeof company.healthScore === 'number' ? company.healthScore : profileStrength(company)
  const strengthColor = strength >= 75 ? '#4ade80' : strength >= 45 ? '#facc15' : '#f87171'
  const siteHref = websiteHref(company)
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

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          {/* Logo / initials */}
          {company.logoUrl ? (
            <Image
              src={company.logoUrl}
              alt={company.name}
              width={64}
              height={64}
              unoptimized
              className="h-16 w-16 shrink-0 rounded-2xl object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-surface-container)] text-xl font-label text-on-surface-variant">
              {initials(company.name)}
            </div>
          )}

          {/* Name + chips */}
          <div className="min-w-0 flex-1">
            <p className="eyebrow !text-[10px]">Account command center</p>
            <h1 className="mt-1 truncate text-3xl font-display leading-tight text-[var(--color-pib-text)]">{company.name}</h1>
            <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
              {company.domain || company.website || company.legalName || 'No domain captured'} · {company.industry || 'Industry not set'}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {company.tier && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-label uppercase tracking-wide ${tierCls}`}>
                  {company.tier}
                </span>
              )}
              {company.lifecycleStage && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-label uppercase tracking-wide ${lcCls}`}>
                  {company.lifecycleStage}
                </span>
              )}
              {company.size && (
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                  {company.size}
                </span>
              )}
              {am && (
                <div className="flex items-center gap-1.5 text-xs text-[var(--color-pib-text-muted)]">
                  {am.avatarUrl ? (
                    <Image src={am.avatarUrl} alt={am.displayName} width={20} height={20} unoptimized className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-surface-container)] text-[9px] font-label text-on-surface-variant">
                      {initials(am.displayName)}
                    </div>
                  )}
                  <span>{am.displayName}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {siteHref && (
            <a
              href={siteHref}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-pib-secondary inline-flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">open_in_new</span>
              Website
            </a>
          )}
          {(company.billingEmail || company.accountsContact?.email) && (
            <a
              href={`mailto:${company.billingEmail || company.accountsContact?.email}`}
              className="btn-pib-secondary inline-flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">mail</span>
              Billing
            </a>
          )}
          {company.phone && (
            <a href={`tel:${company.phone}`} className="btn-pib-secondary inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">call</span>
              Call
            </a>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="cursor-pointer btn-pib-secondary flex items-center gap-1.5 shrink-0"
          >
            <span className="material-symbols-outlined text-[16px]">edit</span>
            Edit
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="cursor-pointer rounded-lg border border-red-400/30 px-3 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting ? 'Archiving...' : 'Archive'}
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.2fr)_2fr]">
        <div className="rounded-xl border border-[var(--color-pib-line)] bg-white/[0.02] p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Profile health</p>
            <span className="font-mono text-sm" style={{ color: strengthColor }}>{strength}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full" style={{ width: `${strength}%`, background: strengthColor }} />
          </div>
          <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">
            {formatCurrency(company.annualRevenue, company.currency)} · {company.employeeCount != null ? `${company.employeeCount.toLocaleString()} people` : 'No size data'}
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {statTiles.map((tile) => (
            <div key={tile.label} className="rounded-xl border border-[var(--color-pib-line)] bg-white/[0.02] px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-[var(--color-pib-text-muted)]">{tile.label}</span>
                <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)]">{tile.icon}</span>
              </div>
              <p className="mt-1 font-mono text-lg text-[var(--color-pib-text)]">{tile.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {signals.length > 0 ? signals.map((signal) => (
          <span key={signal} className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-[var(--color-pib-text-muted)]">
            {signal}
          </span>
        )) : (
          <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-200">
            Setup gaps: add billing, owner, legal, and relationship details.
          </span>
        )}
        {typeof stats?.activity === 'number' && (
          <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-[var(--color-pib-text-muted)]">
            {stats.activity} recent activities
          </span>
        )}
      </div>
    </div>
  )
}
