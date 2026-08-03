'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { HudChip } from '@/components/ui/HudChip'
import type { FinanceSavedView, OperatorAdvancedFilters, OperatorListResourceKind } from '@/lib/accounting/operator-depth-types'
import { applyAdvancedOperatorFilters } from '@/lib/accounting/operator-depth'

type Props = {
  resourceKind: OperatorListResourceKind
  rows: Array<Record<string, any>>
  savedViews: FinanceSavedView[]
  selectedIds: Set<string>
  onSelectedIdsChange: (next: Set<string>) => void
  filters: OperatorAdvancedFilters
  onFiltersChange: (next: OperatorAdvancedFilters) => void
  onSaveView: (name: string) => Promise<void> | void
  onApplyView: (view: FinanceSavedView) => void
  onDeleteView?: (view: FinanceSavedView) => Promise<void> | void
  onPlanSelectAllFiltered: () => Promise<void> | void
  bulkActions?: Array<{ id: string; label: string; onClick: () => void; disabled?: boolean }>
  busy?: boolean
}

export function FinanceOperatorListToolbar({
  resourceKind,
  rows,
  savedViews,
  selectedIds,
  onSelectedIdsChange,
  filters,
  onFiltersChange,
  onSaveView,
  onApplyView,
  onDeleteView,
  onPlanSelectAllFiltered,
  bulkActions = [],
  busy,
}: Props) {
  const [viewName, setViewName] = useState('')
  const filtered = useMemo(() => applyAdvancedOperatorFilters(rows, filters), [rows, filters])
  const allFilteredSelected = filtered.length > 0 && filtered.every((row) => selectedIds.has(row.id))

  return (
    <div className="space-y-3 rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-3 sm:p-4" data-testid="finance-operator-toolbar">
      <div className="flex flex-wrap items-center gap-2">
        <HudChip tone="neutral">{resourceKind.replace('_', ' ')}</HudChip>
        <HudChip tone="neutral">{filtered.length} filtered</HudChip>
        <HudChip tone="neutral">{selectedIds.size} selected</HudChip>
        {busy ? <HudChip tone="warning">Working…</HudChip> : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs text-[var(--color-pib-text-muted)]">
          Search
          <input
            className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
            value={filters.query || ''}
            onChange={(e) => onFiltersChange({ ...filters, query: e.target.value || undefined })}
            placeholder="Number, counterparty, memo"
          />
        </label>
        <label className="block text-xs text-[var(--color-pib-text-muted)]">
          Status
          <input
            className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
            value={filters.status || ''}
            onChange={(e) => onFiltersChange({ ...filters, status: e.target.value || undefined })}
            placeholder="issued / draft / paid"
          />
        </label>
        <label className="block text-xs text-[var(--color-pib-text-muted)]">
          From date
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
            value={filters.fromDate || ''}
            onChange={(e) => onFiltersChange({ ...filters, fromDate: e.target.value || undefined })}
          />
        </label>
        <label className="block text-xs text-[var(--color-pib-text-muted)]">
          To date
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
            value={filters.toDate || ''}
            onChange={(e) => onFiltersChange({ ...filters, toDate: e.target.value || undefined })}
          />
        </label>
        <label className="block text-xs text-[var(--color-pib-text-muted)]">
          Counterparty id
          <input
            className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
            value={filters.counterpartyCompanyId || ''}
            onChange={(e) => onFiltersChange({ ...filters, counterpartyCompanyId: e.target.value || undefined })}
          />
        </label>
        <label className="block text-xs text-[var(--color-pib-text-muted)]">
          Min outstanding (minor)
          <input
            type="number"
            className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
            value={filters.minOutstandingMinor ?? ''}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                minOutstandingMinor: e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
          />
        </label>
        <label className="flex items-end gap-2 text-xs text-[var(--color-pib-text-muted)] pb-2">
          <input
            type="checkbox"
            checked={filters.unallocatedOnly === true}
            onChange={(e) => onFiltersChange({ ...filters, unallocatedOnly: e.target.checked || undefined })}
          />
          Unallocated only
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || filtered.length === 0}
          onClick={() => {
            if (allFilteredSelected) {
              const next = new Set(selectedIds)
              for (const row of filtered) next.delete(row.id)
              onSelectedIdsChange(next)
            } else {
              void onPlanSelectAllFiltered()
              const next = new Set(selectedIds)
              for (const row of filtered.slice(0, 50)) next.add(row.id)
              onSelectedIdsChange(next)
            }
          }}
        >
          {allFilteredSelected ? 'Clear filtered selection' : 'Select all filtered'}
        </Button>
        {bulkActions.map((action) => (
          <Button key={action.id} type="button" size="sm" disabled={busy || action.disabled} onClick={action.onClick}>
            {action.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="block min-w-0 flex-1 text-xs text-[var(--color-pib-text-muted)]">
          Save current filters as view
          <input
            className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            placeholder="e.g. Open AR over 30 days"
          />
        </label>
        <Button
          type="button"
          size="sm"
          disabled={busy || !viewName.trim()}
          onClick={async () => {
            await onSaveView(viewName.trim())
            setViewName('')
          }}
        >
          Save view
        </Button>
      </div>

      {savedViews.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {savedViews.map((view) => (
            <div key={view.id} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-pib-line)] px-2 py-1 text-xs">
              <button type="button" className="font-medium text-[var(--color-pib-text)]" onClick={() => onApplyView(view)}>
                {view.name}
              </button>
              {onDeleteView ? (
                <button type="button" className="text-[var(--color-pib-text-muted)]" aria-label={`Delete view ${view.name}`} onClick={() => void onDeleteView(view)}>
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="pib-empty-state !py-4">
          <p className="pib-empty-state-description">No saved views yet — tune filters and save one for next close.</p>
        </div>
      )}
    </div>
  )
}

export function useFilteredOperatorRows<T extends Record<string, any>>(rows: T[], filters: OperatorAdvancedFilters): T[] {
  return useMemo(() => applyAdvancedOperatorFilters(rows, filters), [rows, filters])
}
