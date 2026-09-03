'use client'

import { useCallback, useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { EmptyState } from '@/components/ui/AppFoundation'
import { Checkbox, Notice, Skeleton, Title } from '@/components/studio'
import {
  FINANCE_OPERATOR_TABLE_SHORTCUTS,
  financeTableRowTabIndex,
  moveFinanceTableFocus,
  nextFinanceTableDensity,
  resolveFinanceTableKeyboardAction,
  type FinanceTableDensity,
} from '@/lib/finance/operator-table-a11y'

type Col<T> = {
  key: string
  header: string
  className?: string
  render: (row: T) => ReactNode
  mobileLabel?: string
  headerSrOnly?: boolean
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
  ariaLabel: string
  density?: FinanceTableDensity
  onDensityChange?: (next: FinanceTableDensity) => void
  onRowActivate?: (row: T) => void
  getRowLabel?: (row: T) => string
  className?: string
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
  ariaLabel,
  density = 'comfortable',
  onDensityChange,
  onRowActivate,
  getRowLabel,
  className = '',
}: Props<T>) {
  const labelId = useId()
  const [activeIndex, setActiveIndex] = useState(0)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    if (activeIndex >= rows.length) setActiveIndex(rows.length > 0 ? rows.length - 1 : 0)
  }, [activeIndex, rows.length])

  const focusRow = useCallback((index: number) => {
    const el = document.querySelector<HTMLElement>(`[data-finance-table-row="${labelId}-${index}"]`)
    el?.focus()
  }, [labelId])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const action = resolveFinanceTableKeyboardAction(event)
      if (!action) return
      if (action === 'help') {
        event.preventDefault()
        setHelpOpen((v) => !v)
        return
      }
      if (action === 'density') {
        if (onDensityChange) {
          event.preventDefault()
          onDensityChange(nextFinanceTableDensity(density))
        }
        return
      }
      if (rows.length === 0) return
      if (action === 'next' || action === 'prev' || action === 'first' || action === 'last') {
        event.preventDefault()
        const next =
          action === 'first' ? 0 : action === 'last' ? rows.length - 1 : moveFinanceTableFocus(activeIndex, rows.length, action === 'next' ? 1 : -1)
        setActiveIndex(next)
        queueMicrotask(() => focusRow(next))
        return
      }
      if (action === 'toggle') {
        const row = rows[activeIndex]
        if (!row) return
        event.preventDefault()
        if (onToggle) onToggle(row.id)
        else if (onRowActivate) onRowActivate(row)
      }
    },
    [activeIndex, density, focusRow, onDensityChange, onRowActivate, onToggle, rows],
  )

  if (loading) {
    return (
      <div data-testid="finance-table-loading" role="status" aria-live="polite" aria-busy="true">
        <Skeleton height="2.75rem" className="mb-2" />
        <Skeleton height="8rem" />
        <p className="sc-body mt-2 text-[var(--sc-ink-soft)]">Loading {ariaLabel.toLowerCase()}.</p>
      </div>
    )
  }

  if (error) {
    return (
      <div data-testid="finance-table-error">
        <Notice tone="danger" title={`Could not load ${ariaLabel.toLowerCase()}`}>
          {error}
        </Notice>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div data-testid="finance-table-empty">
        <EmptyState title={emptyTitle.endsWith('.') ? emptyTitle : `${emptyTitle}.`} description={emptyDescription} />
      </div>
    )
  }

  const densityClass = density === 'dense' ? 'pib-finance-table--dense' : 'pib-finance-table--comfortable'

  return (
    <div className={`space-y-3 pib-finance-table ${densityClass} ${className}`.trim()} data-density={density} data-testid="finance-responsive-table" onKeyDown={handleKeyDown}>
      <p id={labelId} className="sr-only">
        {ariaLabel}. Use arrow keys or j and k to move between rows
        {onToggle ? ', Space or Enter to toggle selection' : ''}. Press question mark for shortcuts
        {onDensityChange ? ', d to toggle dense mode' : ''}.
      </p>

      {helpOpen ? (
        <div className="st-panel st-panel--flat p-3 text-xs" role="region" aria-label="Keyboard shortcuts" data-testid="finance-table-shortcuts">
          <Title as="h3" className="mb-2 text-sm">Keyboard shortcuts</Title>
          <ul className="space-y-1 text-[var(--sc-ink-soft)]">
            {FINANCE_OPERATOR_TABLE_SHORTCUTS.map((item) => (
              <li key={item.keys}>
                <kbd className="rounded border border-[var(--sc-line)] px-1 text-[var(--sc-ink)]">{item.keys}</kbd> - {item.action}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-3 md:hidden" data-testid="finance-table-mobile">
        {rows.map((row, index) => {
          const key = getRowKey ? getRowKey(row) : row.id
          const label = getRowLabel?.(row) || row.id
          return (
            <article
              key={key}
              className="st-panel st-panel--flat p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sc-accent)]"
              tabIndex={financeTableRowTabIndex(index, activeIndex)}
              data-finance-table-row={`${labelId}-${index}`}
              aria-label={label}
              onFocus={() => setActiveIndex(index)}
            >
              {onToggle ? (
                <div className="mb-2">
                  <Checkbox label="Select" checked={selectedIds?.has(row.id) || false} onChange={() => onToggle(row.id)} aria-label={`Select ${label}`} />
                </div>
              ) : null}
              <dl className="space-y-1">
                {columns.map((col) => (
                  <div key={col.key} className="flex items-start justify-between gap-3 text-sm">
                    <dt className="sc-tiny text-[var(--sc-ink-soft)]">{col.mobileLabel || col.header}</dt>
                    <dd className="text-right text-[var(--sc-ink)]">{col.render(row)}</dd>
                  </div>
                ))}
              </dl>
            </article>
          )
        })}
      </div>

      <div className="hidden overflow-x-auto md:block" data-testid="finance-table-desktop">
        <table className="st-table min-w-full text-left text-sm" aria-labelledby={labelId}>
          <caption className="sr-only">{ariaLabel}</caption>
          <thead>
            <tr>
              {onToggle ? <th scope="col" className="sc-tiny finance-table-cell">Select</th> : null}
              {columns.map((col) => (
                <th key={col.key} scope="col" className={`sc-tiny finance-table-cell ${col.className || ''} ${col.headerSrOnly ? 'sr-only' : ''}`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const key = getRowKey ? getRowKey(row) : row.id
              const label = getRowLabel?.(row) || row.id
              const selected = selectedIds?.has(row.id) || false
              return (
                <tr
                  key={key}
                  className="text-[var(--sc-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--sc-accent)]"
                  tabIndex={financeTableRowTabIndex(index, activeIndex)}
                  data-finance-table-row={`${labelId}-${index}`}
                  aria-selected={onToggle ? selected : undefined}
                  onFocus={() => setActiveIndex(index)}
                >
                  {onToggle ? (
                    <td className="finance-table-cell">
                      <Checkbox label={<span className="sr-only">Select {label}</span>} checked={selected} onChange={() => onToggle(row.id)} aria-label={`Select ${label}`} />
                    </td>
                  ) : null}
                  {columns.map((col) => (
                    <td key={col.key} className={`finance-table-cell ${col.className || ''}`}>
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
