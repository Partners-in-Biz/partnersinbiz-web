'use client'

import type { Company } from '@/lib/companies/types'
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
  selectedIds?: Set<string>
  onToggleCompany?: (id: string) => void
  onToggleAll?: () => void
}

export function CompaniesTable({
  companies,
  loading,
  onRowClick,
  selectedIds,
  onToggleCompany,
  onToggleAll,
}: CompaniesTableProps) {
  const selectable = Boolean(selectedIds && onToggleCompany && onToggleAll)
  const allSelected = selectable && companies.length > 0 && selectedIds?.size === companies.length

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
                <span className="material-symbols-outlined text-3xl text-[var(--color-pib-text-muted)] block mb-2">
                  domain
                </span>
                <p className="text-sm text-[var(--color-pib-text-muted)]">
                  No companies yet. Create one to start tracking your accounts.
                </p>
              </td>
            </tr>
          ) : (
            companies.map((company) => (
              <CompanyRow
                key={company.id}
                company={company}
                onClick={onRowClick}
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
