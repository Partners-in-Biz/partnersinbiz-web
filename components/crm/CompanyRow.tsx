'use client'

import Image from 'next/image'
import type { Company } from '@/lib/companies/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(ts: unknown): string {
  if (!ts || typeof ts !== 'object') return 'No update logged'
  const s = (ts as Record<string, unknown>)._seconds
  if (typeof s !== 'number') return '_seconds' in ts ? 'Update date needs review' : 'No update logged'
  const date = new Date(s * 1000)
  if (Number.isNaN(date.getTime())) return 'Update date needs review'
  return date.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function fmtCurrency(value: unknown, currency = 'ZAR'): string {
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

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function accountManagerName(company: Company): string {
  return company.accountManagerRef?.displayName || company.accountManagerUid || 'Unassigned'
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

function websiteHref(value?: string): string {
  const trimmed = value?.trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

// ── Tier / lifecycle colour chips ─────────────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

export interface CompanyRowProps {
  company: Company
  onClick: (id: string) => void
  selected?: boolean
  onToggleSelected?: (id: string) => void
  onSetupProfile?: (id: string) => void
}

export function CompanyRow({ company, onClick, selected = false, onToggleSelected, onSetupProfile }: CompanyRowProps) {
  const lcCls = company.lifecycleStage
    ? (LIFECYCLE_COLOURS[company.lifecycleStage] ?? 'bg-surface-container text-on-surface-variant')
    : ''
  const lifecycleLabel = readableAccountLabel(company.lifecycleStage)
  const strength = profileStrength(company)
  const health = typeof company.healthScore === 'number' ? company.healthScore : strength
  const healthColor = health >= 75 ? '#4ade80' : health >= 45 ? '#facc15' : '#f87171'
  const tierCls = company.tier ? (TIER_COLOURS[company.tier] ?? 'bg-surface-container text-on-surface-variant') : ''
  const tierLabel = readableAccountLabel(company.tier)
  const websiteLabel = company.domain || company.website || ''
  const websiteLink = websiteHref(websiteLabel)
  const hasSetupGap = !company.domain && !company.website && !company.legalName
    || !company.industry
    || company.employeeCount == null && !company.size
  const signals = [
    company.linkedOrgId ? 'Client org' : '',
    company.billingEmail || company.accountsContact?.email ? 'Billing' : '',
    company.purchaseOrderRequired ? 'PO required' : '',
    company.tags?.slice(0, 2).join(', '),
  ].filter(Boolean)

  return (
    <tr
      onClick={() => onClick(company.id)}
      className={`cursor-pointer hover:bg-white/[0.03] transition-colors border-b border-[var(--color-pib-line)] last:border-0 ${selected ? 'bg-[var(--color-pib-accent)]/10' : ''}`}
    >
      {onToggleSelected && (
        <td className="px-4 py-3 w-10" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelected(company.id)}
            className="h-4 w-4 rounded accent-[var(--color-pib-accent)]"
            aria-label={`Select ${company.name}`}
          />
        </td>
      )}

      {/* Logo / initials */}
      <td className="px-4 py-3 w-10">
        {company.logoUrl ? (
          <Image
            src={company.logoUrl}
            alt={company.name}
            width={32}
            height={32}
            unoptimized
            className="w-8 h-8 rounded-full object-cover"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-[var(--color-surface-container)] flex items-center justify-center text-[10px] font-label text-on-surface-variant">
            {initials(company.name)}
          </div>
        )}
      </td>

      {/* Name */}
      <td className="px-4 py-3">
        <p className="text-sm font-medium text-[var(--color-pib-text)] truncate max-w-xs">
          {company.name}
        </p>
        {websiteLink ? (
          <a
            href={websiteLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            aria-label={`Open website for ${company.name}`}
            className="text-[11px] text-[var(--color-pib-text-muted)] font-mono transition-colors hover:text-[var(--color-pib-accent)]"
          >
            {websiteLabel}
          </a>
        ) : (
          <p className="text-[11px] text-[var(--color-pib-text-muted)] font-mono">
            {company.legalName || 'No domain captured'}
          </p>
        )}
      </td>

      {/* Health */}
      <td className="px-4 py-3">
        <div className="min-w-24">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-mono" style={{ color: healthColor }}>{health}%</span>
            <span className="text-[10px] text-[var(--color-pib-text-muted)]">health</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full" style={{ width: `${health}%`, background: healthColor }} />
          </div>
        </div>
      </td>

      {/* Lifecycle */}
      <td className="px-4 py-3">
        {lifecycleLabel && (
          <span className={`text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full ${lcCls}`}>
            {lifecycleLabel}
          </span>
        )}
      </td>

      {/* Profile */}
      <td className="px-4 py-3">
        <div className="space-y-1">
          <span className="text-sm text-[var(--color-pib-text-muted)] truncate max-w-[150px] block">
            {company.industry ?? 'No industry'}
          </span>
          <div className="flex flex-wrap gap-1">
            {tierLabel && (
              <span className={`text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full ${tierCls}`}>
                {tierLabel}
              </span>
            )}
            {company.size && (
              <span className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full bg-white/5 text-[var(--color-pib-text-muted)]">
                {company.size}
              </span>
            )}
          </div>
        </div>
      </td>

      {/* Value */}
      <td className="px-4 py-3">
        <div>
          <span className="text-sm font-mono text-[var(--color-pib-text)]">
            {fmtCurrency(company.annualRevenue, company.currency)}
          </span>
          <p className="text-[11px] text-[var(--color-pib-text-muted)]">
            {company.employeeCount != null ? `${company.employeeCount.toLocaleString()} people` : 'No size data'}
          </p>
        </div>
      </td>

      {/* Account manager */}
      <td className="px-4 py-3">
        {company.accountManagerRef ? (
          <div className="flex items-center gap-2">
            {company.accountManagerRef.avatarUrl ? (
              <Image
                src={company.accountManagerRef.avatarUrl}
                alt={company.accountManagerRef.displayName}
                width={24}
                height={24}
                unoptimized
                className="w-6 h-6 rounded-full object-cover"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-[var(--color-surface-container)] flex items-center justify-center text-[9px] font-label text-on-surface-variant">
                {initials(company.accountManagerRef.displayName)}
              </div>
            )}
            <span className="text-xs text-[var(--color-pib-text-muted)] truncate max-w-[100px]">
              {company.accountManagerRef.displayName}
            </span>
          </div>
        ) : (
          <span className="text-sm text-[var(--color-pib-text-muted)]">{accountManagerName(company)}</span>
        )}
      </td>

      {/* Signals */}
      <td className="px-4 py-3">
        <div className="flex max-w-[180px] flex-wrap gap-1">
          {hasSetupGap && onSetupProfile && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onSetupProfile(company.id)
              }}
              aria-label={`Complete account profile for ${company.name}`}
              className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-200 transition-colors hover:bg-amber-400/20"
            >
              <span className="material-symbols-outlined text-[13px]">fact_check</span>
              Complete profile
            </button>
          )}
          {signals.length > 0 ? signals.map((signal) => (
            <span key={signal} className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-[var(--color-pib-text-muted)]">
              {signal}
            </span>
          )) : (
            <span className="text-xs text-[var(--color-pib-text-muted)]">Needs setup</span>
          )}
        </div>
      </td>

      {/* Updated at */}
      <td className="px-4 py-3">
        <span className="text-xs text-[var(--color-pib-text-muted)]">{fmtDate(company.updatedAt)}</span>
      </td>
    </tr>
  )
}
