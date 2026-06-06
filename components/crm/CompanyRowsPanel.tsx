'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'

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

function readableStatusLabel(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase()
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower
    })
    .join(' ')
}

function CompanyStatusChip({ value, emptyLabel = 'Status not set' }: { value?: unknown; emptyLabel?: string }) {
  if (typeof value !== 'string' || !value.trim()) {
    return <span className="text-xs text-[var(--color-pib-text-muted)]">{emptyLabel}</span>
  }
  return (
    <span className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-label uppercase tracking-wide text-emerald-300">
      {readableStatusLabel(value)}
    </span>
  )
}

function EmptyRowsPanel({
  icon,
  label,
  children,
}: {
  icon: string
  label: string
  children?: ReactNode
}) {
  return (
    <div className="bento-card p-10 text-center">
      <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">{icon}</span>
      <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">
        {label}
      </p>
      {children ? <div className="mt-5 flex justify-center">{children}</div> : null}
    </div>
  )
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
    return <EmptyRowsPanel icon={emptyIcon} label={emptyLabel}>{emptyChildren}</EmptyRowsPanel>
  }

  return (
    <div className="space-y-3">
      {enableFilters ? (
        <div className="bento-card !p-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
          <label className="block">
            <span className="eyebrow !text-[9px]">Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="pib-input mt-1"
            />
          </label>
          <label className="block">
            <span className="eyebrow !text-[9px]">Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="pib-select mt-1">
              <option value="all">All statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="eyebrow !text-[9px]">History</span>
            <select
              value={archiveFilter}
              onChange={(event) => setArchiveFilter(event.target.value as 'active' | 'archived' | 'all')}
              className="pib-select mt-1"
            >
              <option value="active">Active only</option>
              <option value="archived">Archived only</option>
              <option value="all">Active + archived</option>
            </select>
          </label>
        </div>
      ) : null}
      {filteredRows.length === 0 ? (
        <EmptyRowsPanel icon="filter_alt_off" label={filteredEmptyLabel ?? emptyLabel} />
      ) : (
        <div className="bento-card divide-y divide-[var(--color-pib-line)]">
          {filteredRows.map((row) => {
            const rowTitle = title(row)
            const href = hrefFor?.(row) ?? undefined
            const meta = metaFor(row).filter(Boolean)
            const rowContent = (
              <>
                <div className="min-w-0">
                  {href && !linkedRow ? (
                    <Link href={href} className="font-medium text-sm text-[var(--color-accent-v2)] hover:underline">
                      {rowTitle}
                    </Link>
                  ) : (
                    <p className="truncate text-sm font-medium text-[var(--color-pib-text)]">{rowTitle}</p>
                  )}
                  {meta.length > 0 && (
                    <p className="mt-1 truncate text-xs text-[var(--color-pib-text-muted)]">
                      {meta.join(' · ')}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {'status' in row ? <CompanyStatusChip value={row.status} emptyLabel={statusEmptyLabel} /> : null}
                  {href && linkedRow ? (
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)]">
                      open_in_new
                    </span>
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
                  className="flex items-start justify-between gap-4 px-5 py-4 transition-colors hover:bg-white/[0.03] focus:outline-none focus:ring-2 focus:ring-[var(--color-pib-accent)] focus:ring-offset-2 focus:ring-offset-[var(--color-pib-bg)]"
                >
                  {rowContent}
                </Link>
              )
            }

            return (
              <div key={row.id} className="flex items-start justify-between gap-4 px-5 py-4">
                {rowContent}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
