'use client'

// US-076 — Suppression list UI. Consumes the existing /api/v1/suppressions API:
//   GET    list (paginated; meta.total) → { success, data: rows[], meta }
//   POST   add one { email, reason, notes? }
//   DELETE /[id] remove one
// Adds an "Add email" form, client-side CSV import (one email per line, optional
// reason column), per-entry remove, and a total count.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  /** Builds an org-scoped API path (scopedApiPath — appends ?orgId=). */
  apiPath: (path: string) => string
}

const PAGE_SIZE = 50
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
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
    <div className="flex min-h-0 flex-col gap-2">
      {/* Add + import */}
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <form onSubmit={addOne} className="space-y-2 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-3">
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Add email</p>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="someone@example.com"
                className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-on-surface outline-none transition focus:border-[var(--color-accent-v2)]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">
                Reason
              </label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as Reason)}
                className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-on-surface outline-none transition focus:border-[var(--color-accent-v2)]"
              >
                {REASONS.map((r) => (
                  <option key={r} value={r} className="bg-black">
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" disabled={adding} className="flex h-8 items-center gap-1.5 self-start rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition disabled:opacity-40">
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">block</span>
              {adding ? 'Adding…' : 'Suppress email'}
            </button>
          </div>
          {addError && (
            <p className="text-[11px] text-red-300">
              {addError}
            </p>
          )}
        </form>

        <div className="space-y-2 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-3">
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Import CSV</p>
          <p className="text-[11px] leading-4 text-on-surface-variant">
            One email per line. An optional second column sets the reason (defaults to
            <span className="font-mono"> list-cleanup</span>). A header row is detected and skipped.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={handleImportFile}
            disabled={importing}
            className="block w-full text-xs text-on-surface-variant file:mr-3 file:rounded-md file:border file:border-[var(--color-card-border)] file:bg-transparent file:px-2.5 file:py-1.5 file:text-xs file:text-on-surface hover:file:bg-white/[0.05]"
          />
          {importing && <p className="text-[11px] text-on-surface-variant">Importing…</p>}
          {importResult && (
            <p className="text-[11px] text-on-surface">{importResult}</p>
          )}
        </div>
      </div>

      {/* Count + errors */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-on-surface-variant">
          <span className="text-lg font-semibold text-on-surface">{total}</span>{' '}
          suppressed address{total === 1 ? '' : 'es'}
        </p>
        {rowError && (
          <p className="text-[11px] text-red-300">
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
        <section className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-2.5">
              <span className="material-symbols-outlined mt-0.5 text-[18px] text-amber-200" aria-hidden="true">warning</span>
              <div>
                <h2 className="text-sm font-semibold text-on-surface">Suppressions could not load</h2>
                <p className="mt-1 text-xs leading-5 text-on-surface-variant">{loadError}</p>
              </div>
            </div>
            <button type="button" onClick={() => fetchRows(1)} className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-3 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface shrink-0">
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">refresh</span>
              Retry
            </button>
          </div>
        </section>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-4 text-center">
          <span className="material-symbols-outlined text-[19px] text-primary" aria-hidden="true">do_not_disturb_on</span>
          <h2 className="mt-2 text-sm font-semibold text-on-surface">No suppressed addresses.</h2>
          <p className="mt-1 text-xs text-on-surface-variant">
            Bounces, complaints and manual unsubscribes will appear here.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/45">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--color-card-border)] text-left">
                  <th className="px-3 py-2 text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Email</th>
                  <th className="px-3 py-2 text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Reason</th>
                  <th className="px-3 py-2 text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Added</th>
                  <th className="px-3 py-2 text-right text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--color-card-border)] transition hover:bg-white/[0.04] last:border-0">
                    <td className="break-all px-3 py-2 align-middle text-on-surface">{row.email}</td>
                    <td className="px-3 py-2 align-middle">
                      <span className="rounded-full border border-[var(--color-card-border)] px-2 py-0.5 text-[11px] text-on-surface-variant">
                        {row.reason}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-middle text-on-surface-variant">
                      {formatDate(row.createdAt)}
                    </td>
                    <td className="px-3 py-2 align-middle text-right">
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        disabled={removingId === row.id}
                        className="ml-auto flex h-8 items-center gap-1 rounded-md px-2 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-red-300 disabled:opacity-40"
                        aria-label={`Remove ${row.email} from suppression list`}
                      >
                        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">delete</span>
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
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-3 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-[11px] text-on-surface-variant">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => fetchRows(page + 1)}
                disabled={page >= totalPages || loading}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-3 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface disabled:opacity-40"
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
