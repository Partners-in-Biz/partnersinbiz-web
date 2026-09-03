'use client'

// US-076 - Suppression list UI. Consumes the existing /api/v1/suppressions API:
//   GET    list (paginated; meta.total) → { success, data: rows[], meta }
//   POST   add one { email, reason, notes? }
//   DELETE /[id] remove one
// Adds an "Add email" form, client-side CSV import (one email per line, optional
// reason column), per-entry remove, and a total count.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/studio'

const REASONS = [
  'manual-unsub',
  'list-cleanup',
  'hard-bounce',
  'soft-bounce',
  'complaint',
  'invalid-address',
  'disposable-domain',
] as const

type Reason = (typeof REASONS)[number]

interface SuppressionRow {
  id: string
  email: string
  reason: string
  scope?: string
  source?: string
  channel?: string
  createdAt?: string | null
  expiresAt?: string | null
}

interface SuppressionListProps {
  /** Builds an org-scoped API path (scopedApiPath - appends ?orgId=). */
  apiPath: (path: string) => string
}

const PAGE_SIZE = 50
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function formatDate(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function SuppressionList({ apiPath }: SuppressionListProps) {
  const [rows, setRows] = useState<SuppressionRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [email, setEmail] = useState('')
  const [reason, setReason] = useState<Reason>('manual-unsub')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string>('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [removingId, setRemovingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState('')

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])

  const fetchRows = useCallback(
    async (toPage: number) => {
      setLoading(true)
      setLoadError('')
      try {
        const res = await fetch(
          apiPath(`/api/v1/suppressions?page=${toPage}&limit=${PAGE_SIZE}`),
        )
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(typeof body?.error === 'string' ? body.error : `Failed to load (${res.status})`)
        }
        const data: SuppressionRow[] = Array.isArray(body?.data) ? body.data : []
        setRows(data)
        setTotal(typeof body?.meta?.total === 'number' ? body.meta.total : data.length)
        setPage(toPage)
      } catch (err) {
        setRows([])
        setLoadError(err instanceof Error ? err.message : 'Failed to load suppressions')
      } finally {
        setLoading(false)
      }
    },
    [apiPath],
  )

  useEffect(() => {
    fetchRows(1)
  }, [fetchRows])

  async function postEntry(rawEmail: string, entryReason: Reason): Promise<{ ok: boolean; error?: string }> {
    const normalized = rawEmail.trim().toLowerCase()
    if (!EMAIL_RE.test(normalized)) return { ok: false, error: 'Invalid email' }
    try {
      const res = await fetch(apiPath('/api/v1/suppressions'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: normalized, reason: entryReason }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, error: typeof body?.error === 'string' ? body.error : 'Failed' }
      return { ok: true }
    } catch {
      return { ok: false, error: 'Network error' }
    }
  }

  async function addOne(e: React.FormEvent) {
    e.preventDefault()
    setAddError('')
    const normalized = email.trim().toLowerCase()
    if (!EMAIL_RE.test(normalized)) {
      setAddError('Enter a valid email address')
      return
    }
    setAdding(true)
    const result = await postEntry(normalized, reason)
    setAdding(false)
    if (!result.ok) {
      setAddError(result.error ?? 'Failed to add')
      return
    }
    setEmail('')
    await fetchRows(1)
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportResult('')
    try {
      const text = await file.text()
      // Parse: one entry per line. Optional 2nd column = reason. Skip a header
      // row if the first cell isn't a valid email.
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      const entries: Array<{ email: string; reason: Reason }> = []
      const seen = new Set<string>()
      for (const line of lines) {
        const cells = line.split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''))
        const candidate = (cells[0] ?? '').toLowerCase()
        if (!EMAIL_RE.test(candidate)) continue // skips header + junk
        if (seen.has(candidate)) continue
        seen.add(candidate)
        const reasonCell = (cells[1] ?? '').toLowerCase()
        const entryReason: Reason = (REASONS as readonly string[]).includes(reasonCell)
          ? (reasonCell as Reason)
          : 'list-cleanup'
        entries.push({ email: candidate, reason: entryReason })
      }
      if (entries.length === 0) {
        setImportResult('No valid email addresses found in the file.')
        return
      }
      let ok = 0
      let failed = 0
      for (const entry of entries) {
        // Sequential to respect API rate limits and surface partial progress.
        // eslint-disable-next-line no-await-in-loop
        const r = await postEntry(entry.email, entry.reason)
        if (r.ok) ok += 1
        else failed += 1
      }
      setImportResult(`Imported ${ok} address${ok === 1 ? '' : 'es'}${failed ? `, ${failed} failed` : ''}.`)
      await fetchRows(1)
    } catch {
      setImportResult('Could not read the file.')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function removeRow(id: string) {
    setRemovingId(id)
    setRowError('')
    try {
      const res = await fetch(apiPath(`/api/v1/suppressions/${encodeURIComponent(id)}`), {
        method: 'DELETE',
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to remove')
      }
      // Refetch current page (or previous if it emptied).
      const nextPage = rows.length === 1 && page > 1 ? page - 1 : page
      await fetchRows(nextPage)
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Failed to remove')
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {/* Add + import */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <form onSubmit={addOne} className="pib-card space-y-3">
          <p className="pib-label">Add email</p>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="suppression-email" className="pib-label">
                Email address
              </label>
              <input
                id="suppression-email"
                aria-label="Email address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="someone@example.com"
                className="pib-input h-8 w-full text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="suppression-reason" className="pib-label">
                Reason
              </label>
              <select
                id="suppression-reason"
                aria-label="Suppression reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as Reason)}
                className="pib-select h-8 w-full text-xs"
              >
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" disabled={adding} className="btn-pib-primary h-8 gap-1.5 self-start px-3 text-xs">
              <Icon name="block" />
              {adding ? 'Adding…' : 'Suppress email'}
            </button>
          </div>
          {addError && (
            <p className="text-[11px] text-[var(--color-error)]">
              {addError}
            </p>
          )}
        </form>

        <div className="pib-card space-y-3">
          <p className="pib-label">Import CSV</p>
          <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">
            One email per line. An optional second column sets the reason (defaults to
            <span className="font-mono"> list-cleanup</span>). A header row is detected and skipped.
          </p>
          <input
            ref={fileRef}
            aria-label="Import suppression CSV"
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={handleImportFile}
            disabled={importing}
            className="block w-full text-xs text-[var(--color-pib-text-muted)] file:mr-3 file:rounded file:border file:border-[var(--color-pib-line)] file:bg-transparent file:px-2.5 file:py-1.5 file:text-xs file:text-[var(--color-pib-text)] hover:file:bg-[var(--color-row-hover)]"
          />
          {importing && <p className="text-[11px] text-[var(--color-pib-text-muted)]">Importing…</p>}
          {importResult && (
            <p className="text-[11px] text-[var(--color-pib-text)]">{importResult}</p>
          )}
        </div>
      </div>

      {/* Count + errors */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-[var(--color-pib-text-muted)]">
          <span className="text-lg text-[var(--color-pib-text)]">{total}</span>{' '}
          suppressed address{total === 1 ? '' : 'es'}
        </p>
        {rowError && (
          <p className="text-[11px] text-[var(--color-error)]">
            {rowError}
          </p>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="pib-skeleton h-10" />
          ))}
        </div>
      ) : loadError ? (
        <section className="pib-card border-[var(--color-pib-accent)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-2.5">
              <Icon name="warning" className="mt-0.5 text-[var(--color-pib-accent)]" />
              <div>
                <h2 className="text-sm text-[var(--color-pib-text)]">Suppressions could not load</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">{loadError}</p>
              </div>
            </div>
            <button type="button" onClick={() => fetchRows(1)} className="btn-pib-secondary h-8 shrink-0 gap-1.5 px-3 text-xs">
              <Icon name="refresh" />
              Retry
            </button>
          </div>
        </section>
      ) : rows.length === 0 ? (
        <div className="pib-empty-state">
          <Icon name="do_not_disturb_on" />
          <h2 className="pib-empty-state-title">No suppressed addresses.</h2>
          <p className="pib-empty-state-description">
            Bounces, complaints and manual unsubscribes will appear here.
          </p>
        </div>
      ) : (
        <>
          <div className="pib-surface pib-surface-table overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--color-pib-line)] text-left">
                  <th className="pib-label px-3 py-2 text-left">Email</th>
                  <th className="pib-label px-3 py-2 text-left">Reason</th>
                  <th className="pib-label px-3 py-2 text-left">Added</th>
                  <th className="pib-label px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--color-pib-line)] transition hover:bg-[var(--color-row-hover)] last:border-0">
                    <td className="break-all px-3 py-2 align-middle text-[var(--color-pib-text)]">{row.email}</td>
                    <td className="px-3 py-2 align-middle">
                      <span className="pib-pill pib-pill-accent px-2 py-0.5 text-[11px]">
                        {row.reason}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-middle text-[var(--color-pib-text-muted)]">
                      {formatDate(row.createdAt)}
                    </td>
                    <td className="px-3 py-2 align-middle text-right">
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        disabled={removingId === row.id}
                        className="btn-pib-ghost ml-auto h-8 gap-1 px-2 text-xs hover:text-[var(--color-error)]"
                        aria-label={`Remove ${row.email} from suppression list`}
                      >
                        <Icon name="delete" />
                        {removingId === row.id ? 'Removing…' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => fetchRows(page - 1)}
                disabled={page <= 1 || loading}
                className="btn-pib-secondary h-8 gap-1.5 px-3 text-xs"
              >
                Previous
              </button>
              <span className="text-[11px] text-[var(--color-pib-text-muted)]">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => fetchRows(page + 1)}
                disabled={page >= totalPages || loading}
                className="btn-pib-secondary h-8 gap-1.5 px-3 text-xs"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
