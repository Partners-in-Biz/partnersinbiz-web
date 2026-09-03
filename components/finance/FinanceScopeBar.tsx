'use client'

import { Status } from '@/components/studio'
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
    label: `${entity.code} - ${entity.legalName}`,
  }))
  const bookOptions = scope.books.map((book) => ({
    value: book.id,
    label: `${book.code} - ${book.name}`,
  }))

  return (
    <div className={`st-panel ${dense ? 'p-3' : 'p-4'}`} data-testid="finance-scope-bar">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-2">
          <label className="min-w-0">
            <span className="sc-tiny mb-2 block text-[var(--sc-ink-soft)]">Legal entity</span>
            <ThemedSelect
              ariaLabel="Legal entity"
              value={scope.selectedEntityId}
              options={entityOptions.length ? entityOptions : [{ value: '', label: 'No entities', disabled: true }]}
              onValueChange={(value) => scope.setSelectedEntityId(value)}
              disabled={!entityOptions.length}
              className="w-full"
              buttonClassName="w-full justify-between"
            />
          </label>
          <label className="min-w-0">
            <span className="sc-tiny mb-2 block text-[var(--sc-ink-soft)]">Book</span>
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
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Status>{scope.orgId ? `Org ${scope.orgId.slice(0, 12)}${scope.orgId.length > 12 ? '…' : ''}` : 'No org'}</Status>
          <Status tone={scope.selectedEntity?.status === 'active' ? 'success' : undefined}>
            Entity {scope.selectedEntity?.status || '-'}
          </Status>
          <Status>
            Book {scope.selectedBook?.status || '-'}
            {scope.selectedBook?.accountingBasis ? ` · ${scope.selectedBook.accountingBasis}` : ''}
          </Status>
          {scope.selectedBook?.functionalCurrency ? <Status tone="info">{scope.selectedBook.functionalCurrency}</Status> : null}
        </div>
      </div>
    </div>
  )
}
