'use client'

import type { ReactNode } from 'react'

type Col<T> = {
  key: string
  header: string
  className?: string
  render: (row: T) => ReactNode
  mobileLabel?: string
}

type Props<T extends { id: string }> = {
  rows: T[]
  columns: Array<Col<T>>
  selectedIds?: Set<string>
  onToggle?: (id: string) => void
  emptyTitle?: string
  emptyDescription?: string
  loading?: boolean
  error?: string | null
  getRowKey?: (row: T) => string
}

export function FinanceResponsiveTable<T extends { id: string }>({
  rows,
  columns,
  selectedIds,
  onToggle,
  emptyTitle = 'Nothing to show',
  emptyDescription = 'Adjust filters or create the first record in this lane.',
  loading,
  error,
  getRowKey,
}: Props<T>) {
  if (loading) {
    return (
      <div className="pib-empty-state" data-testid="finance-table-loading">
        <span className="material-symbols-outlined pib-empty-state-icon" aria-hidden>
          progress_activity
        </span>
        <p className="pib-empty-state-description">Loading operator list…</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="pib-empty-state" data-testid="finance-table-error">
        <span className="material-symbols-outlined pib-empty-state-icon" aria-hidden>
          error
        </span>
        <h3 className="pib-empty-state-title">Could not load list</h3>
        <p className="pib-empty-state-description">{error}</p>
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="pib-empty-state" data-testid="finance-table-empty">
        <span className="material-symbols-outlined pib-empty-state-icon" aria-hidden>
          inbox
        </span>
        <h3 className="pib-empty-state-title">{emptyTitle}</h3>
        <p className="pib-empty-state-description">{emptyDescription}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Mobile cards */}
      <div className="grid gap-3 md:hidden" data-testid="finance-table-mobile">
        {rows.map((row) => {
          const key = getRowKey ? getRowKey(row) : row.id
          return (
            <article key={key} className="rounded-xl border border-[var(--color-pib-line)] p-3">
              {onToggle ? (
                <label className="mb-2 flex items-center gap-2 text-xs text-[var(--color-pib-text-muted)]">
                  <input type="checkbox" checked={selectedIds?.has(row.id) || false} onChange={() => onToggle(row.id)} />
                  Select
                </label>
              ) : null}
              <dl className="space-y-1">
                {columns.map((col) => (
                  <div key={col.key} className="flex items-start justify-between gap-3 text-sm">
                    <dt className="text-[var(--color-pib-text-muted)]">{col.mobileLabel || col.header}</dt>
                    <dd className="text-right text-[var(--color-pib-text)]">{col.render(row)}</dd>
                  </div>
                ))}
              </dl>
            </article>
          )
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block" data-testid="finance-table-desktop">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">
            <tr className="border-b border-[var(--color-pib-line)]">
              {onToggle ? <th className="py-2 pr-3">Select</th> : null}
              {columns.map((col) => (
                <th key={col.key} className={`py-2 pr-3 ${col.className || ''}`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = getRowKey ? getRowKey(row) : row.id
              return (
                <tr key={key} className="border-t border-[var(--color-pib-line)]">
                  {onToggle ? (
                    <td className="py-2 pr-3">
                      <input type="checkbox" checked={selectedIds?.has(row.id) || false} onChange={() => onToggle(row.id)} aria-label={`Select ${row.id}`} />
                    </td>
                  ) : null}
                  {columns.map((col) => (
                    <td key={col.key} className={`py-2 pr-3 ${col.className || ''}`}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
