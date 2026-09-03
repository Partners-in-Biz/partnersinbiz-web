'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { CompanyRecordEmptyPanel, CompanyRecordStatusChip } from '@/components/crm/CompanyRecordPrimitives'
import { Icon } from '@/components/studio'

export type CompanyRowsPanelRow = {
  id: string
  status?: unknown
  archived?: unknown
  [key: string]: unknown
}

type CompanyRowsPanelProps<Row extends CompanyRowsPanelRow> = {
  rows: Row[]
  emptyIcon: string
  emptyLabel: string
  emptyContent?: ReactNode
  filteredEmptyLabel?: string
  emptyChildren?: ReactNode
  title: (row: Row) => string
  hrefFor?: (row: Row) => string | undefined | null
  rowAriaLabel?: (row: Row, title: string) => string
  metaFor: (row: Row) => Array<string | undefined | null | false>
  enableFilters?: boolean
  searchPlaceholder?: string
  statusEmptyLabel?: string
  linkedRow?: boolean
}

function rowStatus(row: CompanyRowsPanelRow): string | undefined {
  return typeof row.status === 'string' ? row.status : undefined
}

export function CompanyRowsPanel<Row extends CompanyRowsPanelRow>({
  rows,
  emptyIcon,
  emptyLabel,
  emptyContent,
  filteredEmptyLabel,
  emptyChildren,
  title,
  hrefFor,
  rowAriaLabel,
  metaFor,
  enableFilters = false,
  searchPlaceholder = 'Search rows...',
  statusEmptyLabel = 'Status not set',
  linkedRow = false,
}: CompanyRowsPanelProps<Row>) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [archiveFilter, setArchiveFilter] = useState<'active' | 'archived' | 'all'>('active')

  const statusOptions = Array.from(new Set(
    rows
      .map((row) => rowStatus(row))
      .filter((status): status is string => Boolean(status) && status !== 'archived'),
  )).sort()

  const filteredRows = enableFilters ? rows.filter((row) => {
    const isArchived = row.archived === true || row.status === 'archived'
    if (archiveFilter === 'active' && isArchived) return false
    if (archiveFilter === 'archived' && !isArchived) return false
    if (statusFilter !== 'all' && row.status !== statusFilter) return false
    const q = query.trim().toLowerCase()
    if (!q) return true
    const rowTitle = title(row)
    const meta = metaFor(row).filter(Boolean)
    return [rowTitle, rowStatus(row), ...meta]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q)
  }) : rows

  if (rows.length === 0) {
    if (emptyContent) return emptyContent
    return <CompanyRecordEmptyPanel icon={emptyIcon} label={emptyLabel}>{emptyChildren}</CompanyRecordEmptyPanel>
  }

  return (
    <div className="space-y-2">
      {enableFilters ? (
        <div className="grid gap-2 rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/65 px-2 py-1.5 md:grid-cols-[minmax(0,1fr)_180px_180px]">
          <label className="block">
            <span className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="mt-1 h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]/60 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-1 h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-[var(--color-pib-text)] focus:outline-none">
              <option value="all">All statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">History</span>
            <select
              value={archiveFilter}
              onChange={(event) => setArchiveFilter(event.target.value as 'active' | 'archived' | 'all')}
              className="mt-1 h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-[var(--color-pib-text)] focus:outline-none"
            >
              <option value="active">Active only</option>
              <option value="archived">Archived only</option>
              <option value="all">Active + archived</option>
            </select>
          </label>
        </div>
      ) : null}
      {filteredRows.length === 0 ? (
        <CompanyRecordEmptyPanel icon="filter_alt_off" label={filteredEmptyLabel ?? emptyLabel} />
      ) : (
        <div className="rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/45 divide-y divide-[var(--color-card-border)]">
          {filteredRows.map((row) => {
            const rowTitle = title(row)
            const href = hrefFor?.(row) ?? undefined
            const meta = metaFor(row).filter(Boolean)
            const rowContent = (
              <>
                <div className="min-w-0">
                  {href && !linkedRow ? (
                    <Link href={href} className="text-xs font-medium text-primary hover:underline">
                      {rowTitle}
                    </Link>
                  ) : (
                    <p className="truncate text-xs font-medium text-[var(--color-pib-text)]">{rowTitle}</p>
                  )}
                  {meta.length > 0 && (
                    <p className="mt-0.5 truncate text-[11px] text-[var(--color-pib-text-muted)]">
                      {meta.join(' · ')}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {'status' in row ? <CompanyRecordStatusChip value={row.status} emptyLabel={statusEmptyLabel} /> : null}
                  {href && linkedRow ? (
                    <Icon name="open_in_new" className="text-[16px] text-[var(--color-pib-text-muted)]" />
                  ) : null}
                </div>
              </>
            )

            if (href && linkedRow) {
              return (
                <Link
                  key={row.id}
                  href={href}
                  aria-label={rowAriaLabel?.(row, rowTitle)}
                  className="flex items-start justify-between gap-3 px-3 py-2 transition-colors hover:bg-white/[0.04] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-v2)] focus:ring-offset-2 focus:ring-offset-[var(--color-surface)]"
                >
                  {rowContent}
                </Link>
              )
            }

            return (
              <div key={row.id} className="flex items-start justify-between gap-3 px-3 py-2">
                {rowContent}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
