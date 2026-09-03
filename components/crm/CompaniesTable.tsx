'use client'

import type { Company } from '@/lib/companies/types'
import Link from 'next/link'
import { CompanyRow } from '@/components/crm/CompanyRow'
import { Icon } from '@/components/studio'

// ── Column headers ────────────────────────────────────────────────────────────

const COLUMNS = [
  { key: 'logo',         label: '' },
  { key: 'name',         label: 'Account' },
  { key: 'health',       label: 'Health' },
  { key: 'lifecycle',    label: 'Lifecycle' },
  { key: 'profile',      label: 'Profile' },
  { key: 'value',        label: 'Value' },
  { key: 'am',           label: 'Owner' },
  { key: 'signals',      label: 'Signals' },
  { key: 'updatedAt',    label: 'Updated' },
]

// ── Loading skeleton ──────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-[var(--color-card-border)]">
      <td className="px-3 py-2"><div className="pib-skeleton w-7 h-7 rounded" /></td>
      <td className="px-3 py-2"><div className="pib-skeleton h-4 w-36 rounded" /></td>
      <td className="px-3 py-2"><div className="pib-skeleton h-4 w-20 rounded" /></td>
      <td className="px-3 py-2"><div className="pib-skeleton h-4 w-20 rounded" /></td>
      <td className="px-3 py-2"><div className="pib-skeleton h-4 w-16 rounded" /></td>
      <td className="px-3 py-2"><div className="pib-skeleton h-4 w-24 rounded" /></td>
      <td className="px-3 py-2"><div className="pib-skeleton h-4 w-28 rounded" /></td>
      <td className="px-3 py-2"><div className="pib-skeleton h-4 w-20 rounded" /></td>
    </tr>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export interface CompaniesTableProps {
  companies: Company[]
  loading: boolean
  onRowClick: (id: string) => void
  onSetupCompany?: (id: string) => void
  newCompanyHref?: string
  migrateHref?: string
  selectedIds?: Set<string>
  onToggleCompany?: (id: string) => void
  onToggleAll?: () => void
  emptyState?: {
    icon: string
    eyebrow: string
    title: string
    description: string
    primaryAction?: {
      label: string
      icon: string
      onClick: () => void
      variant?: 'accent' | 'secondary'
    }
  }
}

export function CompaniesTable({
  companies,
  loading,
  onRowClick,
  onSetupCompany,
  newCompanyHref = '/portal/companies/new',
  migrateHref = '/portal/companies/migrate',
  selectedIds,
  onToggleCompany,
  onToggleAll,
  emptyState,
}: CompaniesTableProps) {
  const selectable = Boolean(selectedIds && onToggleCompany && onToggleAll)
  const allSelected = selectable && companies.length > 0 && selectedIds?.size === companies.length
  const state = emptyState ?? {
    icon: 'domain',
    eyebrow: 'Start account setup',
    title: 'No companies yet',
    description: 'Create the first account from company details, owner, lifecycle, and revenue context.',
  }

  return (
    <div className="pib-surface pib-surface-table w-full overflow-x-auto" data-module-accent="amber">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[var(--color-card-border)]">
            {selectable && (
              <th className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleAll}
                  className="h-4 w-4 rounded accent-[var(--color-accent-v2)]"
                  aria-label="Select all companies"
                />
              </th>
            )}
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className="px-3 py-2 text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)] whitespace-nowrap"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {loading ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : companies.length === 0 ? (
            <tr>
              <td colSpan={COLUMNS.length + (selectable ? 1 : 0)} className="px-3 py-6 text-center">
                <div className="mx-auto flex max-w-md flex-col items-center px-3 py-3">
                  <Icon name={state.icon} className="text-primary" />
                  <p className="mt-3 text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">{state.eyebrow}</p>
                  <h3 className="mt-1.5 text-sm text-[var(--color-pib-text)]">{state.title}</h3>
                  <p className="mt-1.5 max-w-md text-xs leading-5 text-[var(--color-pib-text-muted)]">
                    {state.description}
                  </p>
                  <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                    {state.primaryAction ? (
                      <button
                        type="button"
                        onClick={state.primaryAction.onClick}
                        className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition ${state.primaryAction.variant === 'accent' ? 'bg-[var(--color-accent-v2)] text-black' : 'bg-primary/10 text-primary hover:bg-primary/15'}`}
                        aria-label={state.primaryAction.label}
                      >
                        <Icon name={state.primaryAction.icon} />
                        {state.primaryAction.label}
                      </button>
                    ) : (
                      <>
                        <Link
                          href={newCompanyHref}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition hover:opacity-90"
                        >
                          <Icon name="add_business" />
                          Create first company
                        </Link>
                        <Link
                          href={migrateHref}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-3 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
                        >
                          <Icon name="sync_alt" />
                          Migrate from contacts
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              </td>
            </tr>
          ) : (
            companies.map((company) => (
              <CompanyRow
                key={company.id}
                company={company}
                onClick={onRowClick}
                onSetupProfile={onSetupCompany}
                onEditValue={onSetupCompany}
                onEditLifecycle={onSetupCompany}
                onEditOwner={onSetupCompany}
                onImproveHealth={onSetupCompany}
                onEditProfile={onSetupCompany}
                selected={selectedIds?.has(company.id) ?? false}
                onToggleSelected={onToggleCompany}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
