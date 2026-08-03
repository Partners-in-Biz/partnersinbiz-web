'use client'

import { Card } from '@/components/ui/Card'
import { HudChip } from '@/components/ui/HudChip'
import { ThemedSelect } from '@/components/ui/ThemedSelect'
import type { AccountingBook, LegalEntity } from '@/components/finance/financeWorkbench'

type ScopeLike = {
  entities: LegalEntity[]
  books: AccountingBook[]
  selectedEntityId: string
  setSelectedEntityId: (id: string) => void
  selectedBookId: string
  setSelectedBookId: (id: string) => void
  selectedEntity?: LegalEntity
  selectedBook?: AccountingBook
  orgId?: string
}

export function FinanceScopeBar({
  scope,
  onBookChange,
  dense = false,
}: {
  scope: ScopeLike
  onBookChange?: (bookId: string) => void
  dense?: boolean
}) {
  const entityOptions = scope.entities.map((entity) => ({
    value: entity.id,
    label: `${entity.code} — ${entity.legalName}`,
  }))
  const bookOptions = scope.books.map((book) => ({
    value: book.id,
    label: `${book.code} — ${book.name}`,
  }))

  return (
    <Card className={dense ? 'p-3' : 'p-4'} data-testid="finance-scope-bar">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
          <label className="min-w-0 text-xs text-[var(--color-pib-text-muted)]">
            Legal entity
            <div className="mt-1">
              <ThemedSelect
                ariaLabel="Legal entity"
                value={scope.selectedEntityId}
                options={entityOptions.length ? entityOptions : [{ value: '', label: 'No entities', disabled: true }]}
                onValueChange={(value) => scope.setSelectedEntityId(value)}
                disabled={!entityOptions.length}
                className="w-full"
                buttonClassName="w-full justify-between"
              />
            </div>
          </label>
          <label className="min-w-0 text-xs text-[var(--color-pib-text-muted)]">
            Book
            <div className="mt-1">
              <ThemedSelect
                ariaLabel="Accounting book"
                value={scope.selectedBookId}
                options={bookOptions.length ? bookOptions : [{ value: '', label: 'No books', disabled: true }]}
                onValueChange={(value) => {
                  scope.setSelectedBookId(value)
                  onBookChange?.(value)
                }}
                disabled={!bookOptions.length}
                className="w-full"
                buttonClassName="w-full justify-between"
              />
            </div>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <HudChip>{scope.orgId ? `Org ${scope.orgId.slice(0, 12)}${scope.orgId.length > 12 ? '…' : ''}` : 'No org'}</HudChip>
          <HudChip tone={scope.selectedEntity?.status === 'active' ? 'live' : 'default'}>
            Entity {scope.selectedEntity?.status || '—'}
          </HudChip>
          <HudChip>
            Book {scope.selectedBook?.status || '—'}
            {scope.selectedBook?.accountingBasis ? ` · ${scope.selectedBook.accountingBasis}` : ''}
          </HudChip>
          {scope.selectedBook?.functionalCurrency ? (
            <HudChip tone="accent">{scope.selectedBook.functionalCurrency}</HudChip>
          ) : null}
        </div>
      </div>
    </Card>
  )
}
