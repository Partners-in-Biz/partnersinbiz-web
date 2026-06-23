'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { StatusPill } from '@/components/ui/AppFoundation'

export interface AdminOrgRow {
  id: string
  name: string
  slug: string
  status: string
  plan: string
  createdAt: number | null
  ownerEmail: string
  mrr: number
  contacts: number
  sends30d: number
  description?: string
}

type SortKey = 'name' | 'ownerEmail' | 'plan' | 'mrr' | 'contacts' | 'sends30d' | 'createdAt' | 'status'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 25

const STATUS_TONE: Record<string, 'success' | 'accent' | 'danger' | 'neutral' | 'warn'> = {
  active: 'success',
  trial: 'accent',
  onboarding: 'accent',
  suspended: 'danger',
  past_due: 'warn',
  churned: 'neutral',
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  trial: 'Trial',
  onboarding: 'Onboarding',
  suspended: 'Suspended',
  past_due: 'Past due',
  churned: 'Churned',
}

function zar(n: number): string {
  return `R${Math.round(n).toLocaleString('en-ZA')}`
}

function fmtDate(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' })
}

function planLabel(plan: string): string {
  if (!plan) return '—'
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}

function csvCell(value: string | number | null): string {
  const s = value == null ? '' : String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export default function OrgsTable({ orgs }: { orgs: AdminOrgRow[] }) {
  const [search, setSearch] = useState('')
  const [planFilter, setPlanFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)

  const planOptions = useMemo(
    () => Array.from(new Set(orgs.map((o) => o.plan).filter(Boolean))).sort(),
    [orgs],
  )
  const statusOptions = useMemo(
    () => Array.from(new Set(orgs.map((o) => o.status).filter(Boolean))).sort(),
    [orgs],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = orgs.filter((o) => {
      if (planFilter && o.plan !== planFilter) return false
      if (statusFilter && o.status !== statusFilter) return false
      if (q) {
        const hay = `${o.name} ${o.ownerEmail}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    const dir = sortDir === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      let av: string | number
      let bv: string | number
      switch (sortKey) {
        case 'name':
          av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break
        case 'ownerEmail':
          av = a.ownerEmail.toLowerCase(); bv = b.ownerEmail.toLowerCase(); break
        case 'plan':
          av = a.plan.toLowerCase(); bv = b.plan.toLowerCase(); break
        case 'status':
          av = a.status.toLowerCase(); bv = b.status.toLowerCase(); break
        case 'mrr':
          av = a.mrr; bv = b.mrr; break
        case 'contacts':
          av = a.contacts; bv = b.contacts; break
        case 'sends30d':
          av = a.sends30d; bv = b.sends30d; break
        case 'createdAt':
          av = a.createdAt ?? 0; bv = b.createdAt ?? 0; break
      }
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
    return rows
  }, [orgs, search, planFilter, statusFilter, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      // Text columns default A→Z; numeric/date columns default high→low.
      setSortDir(['name', 'ownerEmail', 'plan', 'status'].includes(key) ? 'asc' : 'desc')
    }
    setPage(0)
  }

  function exportCsv() {
    const headers = ['Name', 'Owner email', 'Plan', 'MRR (ZAR)', 'Contacts', 'Sends (30d)', 'Created', 'Status']
    const lines = [headers.map(csvCell).join(',')]
    for (const o of filtered) {
      lines.push([
        csvCell(o.name),
        csvCell(o.ownerEmail),
        csvCell(planLabel(o.plan)),
        csvCell(o.mrr),
        csvCell(o.contacts),
        csvCell(o.sends30d),
        csvCell(o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : ''),
        csvCell(STATUS_LABEL[o.status] ?? o.status),
      ].join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `organisations-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function SortHeader({ label, k, align = 'left' }: { label: string; k: SortKey; align?: 'left' | 'right' }) {
    const active = sortKey === k
    return (
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={`flex items-center gap-1 text-[10px] font-label uppercase tracking-widest transition-colors hover:text-on-surface ${active ? 'text-on-surface' : 'text-on-surface-variant'} ${align === 'right' ? 'ml-auto' : ''}`}
      >
        <span>{label}</span>
        <span aria-hidden className="text-[9px] leading-none">
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </button>
    )
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
        <input
          type="text"
          placeholder="Search by name or owner email..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0) }}
          className="flex-1 min-w-[220px] px-4 py-2.5 text-sm bg-[var(--color-card)] border border-[var(--color-card-border)] rounded-[var(--radius-btn)] text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-[var(--color-accent-v2)] transition-colors"
        />
        <select
          value={planFilter}
          onChange={(e) => { setPlanFilter(e.target.value); setPage(0) }}
          className="px-3 py-2.5 text-sm bg-[var(--color-card)] border border-[var(--color-card-border)] rounded-[var(--radius-btn)] text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)]"
        >
          <option value="">All plans</option>
          {planOptions.map((p) => (
            <option key={p} value={p}>{planLabel(p)}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0) }}
          className="px-3 py-2.5 text-sm bg-[var(--color-card)] border border-[var(--color-card-border)] rounded-[var(--radius-btn)] text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)]"
        >
          <option value="">All statuses</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="pib-btn-secondary text-sm font-label disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      <p className="text-xs text-on-surface-variant">
        Showing {filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1}
        –{Math.min(filtered.length, safePage * PAGE_SIZE + PAGE_SIZE)} of {filtered.length}
        {filtered.length !== orgs.length ? ` (filtered from ${orgs.length})` : ''}
      </p>

      {/* Table */}
      <div className="pib-card overflow-x-auto !p-0">
        <div className="min-w-[920px]">
          {/* Header */}
          <div className="grid grid-cols-[minmax(180px,2.2fr)_minmax(160px,1.8fr)_90px_100px_90px_100px_110px_100px_70px] gap-3 px-5 py-3 border-b border-[var(--color-card-border)]">
            <SortHeader label="Organisation" k="name" />
            <SortHeader label="Owner email" k="ownerEmail" />
            <SortHeader label="Plan" k="plan" />
            <div className="flex justify-end"><SortHeader label="MRR" k="mrr" align="right" /></div>
            <div className="flex justify-end"><SortHeader label="Contacts" k="contacts" align="right" /></div>
            <div className="flex justify-end"><SortHeader label="Sends 30d" k="sends30d" align="right" /></div>
            <SortHeader label="Created" k="createdAt" />
            <SortHeader label="Status" k="status" />
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant text-right">Open</p>
          </div>

          {/* Rows */}
          {pageRows.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-on-surface-variant text-sm">No organisations match your filters.</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-card-border)]">
              {pageRows.map((org) => (
                <div
                  key={org.id}
                  className="grid grid-cols-[minmax(180px,2.2fr)_minmax(160px,1.8fr)_90px_100px_90px_100px_110px_100px_70px] gap-3 items-center px-5 py-3.5 hover:bg-[var(--color-row-hover)] transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-on-surface truncate">{org.name}</p>
                    {org.description ? (
                      <p className="text-xs text-on-surface-variant truncate mt-0.5">{org.description}</p>
                    ) : null}
                  </div>
                  <p className="text-sm text-on-surface-variant truncate" title={org.ownerEmail}>
                    {org.ownerEmail || '—'}
                  </p>
                  <p className="text-sm text-on-surface-variant">{planLabel(org.plan)}</p>
                  <p className="text-sm text-on-surface text-right tabular-nums">{org.mrr > 0 ? zar(org.mrr) : '—'}</p>
                  <p className="text-sm text-on-surface-variant text-right tabular-nums">{org.contacts.toLocaleString('en-ZA')}</p>
                  <p className="text-sm text-on-surface-variant text-right tabular-nums">{org.sends30d.toLocaleString('en-ZA')}</p>
                  <p className="text-xs text-on-surface-variant">{fmtDate(org.createdAt)}</p>
                  <div>
                    <StatusPill tone={STATUS_TONE[org.status] ?? 'neutral'} dot>
                      {STATUS_LABEL[org.status] ?? org.status}
                    </StatusPill>
                  </div>
                  <div className="flex justify-end gap-1.5">
                    <Link
                      href={org.slug ? `/admin/org/${org.slug}/dashboard` : `/admin/organizations/${org.id}`}
                      className="pib-btn-secondary text-xs font-label !px-2.5"
                      title="Open admin workspace"
                    >
                      ↗
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pagination */}
      {pageCount > 1 ? (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            className="pib-btn-secondary text-xs font-label disabled:opacity-40"
          >
            ← Previous
          </button>
          <p className="text-xs text-on-surface-variant">Page {safePage + 1} of {pageCount}</p>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
            className="pib-btn-secondary text-xs font-label disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      ) : null}
    </div>
  )
}
