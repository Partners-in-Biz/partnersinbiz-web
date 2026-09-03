'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Checkbox, Field, Input, Status, Toolbar } from '@/components/studio'
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
    <div className="st-panel space-y-4 p-4" data-testid="finance-operator-toolbar">
      <Toolbar className="flex-wrap gap-2">
        <Status>{resourceKind.replace('_', ' ')}</Status>
        <Status>{filtered.length} filtered</Status>
        <Status>{selectedIds.size} selected</Status>
        {busy ? <Status tone="warning">Working</Status> : null}
      </Toolbar>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="op-search" label="Search">
          <Input id="op-search" aria-label="Search" value={filters.query || ''} onChange={(e) => onFiltersChange({ ...filters, query: e.target.value || undefined })} placeholder="Number, counterparty, memo" />
        </Field>
        <Field id="op-status" label="Status">
          <Input id="op-status" aria-label="Status" value={filters.status || ''} onChange={(e) => onFiltersChange({ ...filters, status: e.target.value || undefined })} placeholder="issued / draft / paid" />
        </Field>
        <Field id="op-from" label="From date">
          <Input id="op-from" aria-label="From date" type="date" value={filters.fromDate || ''} onChange={(e) => onFiltersChange({ ...filters, fromDate: e.target.value || undefined })} />
        </Field>
        <Field id="op-to" label="To date">
          <Input id="op-to" aria-label="To date" type="date" value={filters.toDate || ''} onChange={(e) => onFiltersChange({ ...filters, toDate: e.target.value || undefined })} />
        </Field>
        <Field id="op-counterparty" label="Counterparty id">
          <Input id="op-counterparty" aria-label="Counterparty id" value={filters.counterpartyCompanyId || ''} onChange={(e) => onFiltersChange({ ...filters, counterpartyCompanyId: e.target.value || undefined })} />
        </Field>
        <Field id="op-min" label="Min outstanding (minor)">
          <Input
            id="op-min"
            aria-label="Min outstanding (minor)"
            type="number"
            value={filters.minOutstandingMinor ?? ''}
            onChange={(e) => onFiltersChange({ ...filters, minOutstandingMinor: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        </Field>
        <div className="flex items-end pb-1">
          <Checkbox label="Unallocated only" checked={filters.unallocatedOnly === true} onChange={(e) => onFiltersChange({ ...filters, unallocatedOnly: e.target.checked || undefined })} />
        </div>
      </div>

      <Toolbar className="flex-wrap gap-2">
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
      </Toolbar>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Field id="op-view-name" label="Save current filters as view">
            <Input id="op-view-name" aria-label="Save current filters as view" value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="e.g. Open AR over 30 days" />
          </Field>
        </div>
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
            <div key={view.id} className="inline-flex items-center gap-1 border border-[var(--sc-line)] px-2 py-1 text-xs">
              <button type="button" className="font-medium text-[var(--sc-ink)]" onClick={() => onApplyView(view)}>
                {view.name}
              </button>
              {onDeleteView ? (
                <button type="button" className="text-[var(--sc-ink-soft)]" aria-label={`Delete view ${view.name}`} onClick={() => void onDeleteView(view)}>
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="sc-body text-sm text-[var(--sc-ink-soft)]">No saved views yet. Tune filters and save one for next close.</p>
      )}
    </div>
  )
}

export function useFilteredOperatorRows<T extends Record<string, any>>(rows: T[], filters: OperatorAdvancedFilters): T[] {
  return useMemo(() => applyAdvancedOperatorFilters(rows, filters), [rows, filters])
}
