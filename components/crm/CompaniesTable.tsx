'use client'

import type { Company } from '@/lib/companies/types'
import Link from 'next/link'
import { CompanyRow } from '@/components/crm/CompanyRow'

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
    <tr className="border-b border-[var(--color-pib-line)]">
      <td className="px-4 py-3"><div className="pib-skeleton w-8 h-8 rounded-full" /></td>
      <td className="px-4 py-3"><div className="pib-skeleton h-4 w-36 rounded" /></td>
      <td className="px-4 py-3"><div className="pib-skeleton h-4 w-20 rounded" /></td>
      <td className="px-4 py-3"><div className="pib-skeleton h-4 w-20 rounded" /></td>
      <td className="px-4 py-3"><div className="pib-skeleton h-4 w-16 rounded" /></td>
      <td className="px-4 py-3"><div className="pib-skeleton h-4 w-24 rounded" /></td>
      <td className="px-4 py-3"><div className="pib-skeleton h-4 w-28 rounded" /></td>
      <td className="px-4 py-3"><div className="pib-skeleton h-4 w-20 rounded" /></td>
    </tr>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export interface CompaniesTableProps {
  companies: Company[]
  loading: boolean
  onRowClick: (id: string) => void
  onSetupCompany?: (id: string) => void
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
    <div className="pib-card-section w-full overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[var(--color-pib-line)] bg-white/[0.02]">
            {selectable && (
              <th className="px-4 py-2.5">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleAll}
                  className="h-4 w-4 rounded accent-[var(--color-pib-accent)]"
                  aria-label="Select all companies"
                />
              </th>
            )}
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className="px-4 py-2.5 text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] whitespace-nowrap"
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
              <td colSpan={COLUMNS.length + (selectable ? 1 : 0)} className="px-4 py-16 text-center">
                <div className="mx-auto flex max-w-2xl flex-col items-center rounded-xl border border-dashed border-[var(--color-pib-line)] bg-white/[0.03] px-5 py-6">
                  <span className="material-symbols-outlined flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.04] text-3xl text-[var(--color-pib-text-muted)]">
                    {state.icon}
                  </span>
                  <p className="eyebrow mt-4 !text-[10px]">{state.eyebrow}</p>
                  <h3 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">{state.title}</h3>
                  <p className="mt-2 max-w-md text-sm leading-6 text-[var(--color-pib-text-muted)]">
                    {state.description}
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {state.primaryAction ? (
                      <button
                        type="button"
                        onClick={state.primaryAction.onClick}
                        className={`${state.primaryAction.variant === 'accent' ? 'btn-pib-accent' : 'btn-pib-secondary'} inline-flex items-center gap-1.5 text-xs`}
                      >
                        <span className="material-symbols-outlined text-[15px]">{state.primaryAction.icon}</span>
                        {state.primaryAction.label}
                      </button>
                    ) : (
                      <>
                        <Link
                          href="/portal/companies/new"
                          className="btn-pib-accent inline-flex items-center gap-1.5 text-xs"
                        >
                          <span className="material-symbols-outlined text-[15px]">add_business</span>
                          Create first company
                        </Link>
                        <Link
                          href="/portal/companies/migrate"
                          className="btn-pib-secondary inline-flex items-center gap-1.5 text-xs"
                        >
                          <span className="material-symbols-outlined text-[15px]">sync_alt</span>
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
