'use client'
import { Icon } from '@/components/studio'

import { useCallback, useEffect, useMemo, useState } from 'react'

interface OrgRow {
  orgId: string
  name: string
  slug: string | null
  plan: string | null
  bytes: number
  files: number
  limitBytes: number | null
}
interface StorageData {
  totalBytes: number
  totalFiles: number
  byType: Record<string, number>
  byOrg: OrgRow[]
  cap: number
  capped: boolean
  plans: string[]
  sources: {
    uploads: { count: number; primary: boolean }
    social_media: { count: number; sizeField: string }
  }
}
interface Orphan {
  path: string
  sizeBytes: number
  updated: string | null
}
interface MissingBlob {
  id: string
  storagePath: string
  orgId: string | null
}
interface OrphansData {
  orphans: Orphan[]
  missingBlobs: MissingBlob[]
  scanCap: number
  scanned: number
  truncated: boolean
  storageAvailable: boolean
  note?: string
}
interface SessionInfo {
  isSuperAdmin?: boolean
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const val = bytes / Math.pow(1024, i)
  return `${val.toFixed(val >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

const TYPE_COLORS: Record<string, string> = {
  image: 'var(--color-primary, #6750a4)',
  video: '#d9534f',
  application: '#5bc0de',
  audio: '#f0ad4e',
  text: '#5cb85c',
  unknown: '#9e9e9e',
}

export default function StorageClient() {
  const [data, setData] = useState<StorageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [planFilter, setPlanFilter] = useState('')
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // override form
  const [ovOrg, setOvOrg] = useState('')
  const [ovOrgName, setOvOrgName] = useState('')
  const [ovMb, setOvMb] = useState('')
  const [ovConfirm, setOvConfirm] = useState('')
  const [ovBusy, setOvBusy] = useState(false)

  // orphans
  const [orphans, setOrphans] = useState<OrphansData | null>(null)
  const [orphansLoading, setOrphansLoading] = useState(true)
  const [orphansError, setOrphansError] = useState<string | null>(null)
  const [delConfirm, setDelConfirm] = useState<Record<string, string>>({})
  const [delBusy, setDelBusy] = useState<string | null>(null)

  const load = useCallback(async (plan: string) => {
    setLoading(true)
    setError(null)
    try {
      const qs = plan ? `?plan=${encodeURIComponent(plan)}` : ''
      const res = await fetch(`/api/v1/admin/system/storage${qs}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to load')
      setData((body.data ?? body) as StorageData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadOrphans = useCallback(async () => {
    setOrphansLoading(true)
    setOrphansError(null)
    try {
      const res = await fetch('/api/v1/admin/system/storage/orphans')
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to load orphans')
      setOrphans((body.data ?? body) as OrphansData)
    } catch (err) {
      setOrphansError(err instanceof Error ? err.message : 'Failed to load orphans')
    } finally {
      setOrphansLoading(false)
    }
  }, [])

  useEffect(() => {
    load(planFilter)
  }, [load, planFilter])
  useEffect(() => {
    loadOrphans()
  }, [loadOrphans])
  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/verify')
      .then((r) => (r.ok ? r.json() : null))
      .then((s: SessionInfo | null) => {
        if (!cancelled) setIsSuperAdmin(Boolean(s?.isSuperAdmin))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  function selectOrgForOverride(row: OrgRow) {
    setOvOrg(row.orgId)
    setOvOrgName(row.name)
    setOvMb(row.limitBytes != null ? String(Math.round(row.limitBytes / (1024 * 1024))) : '')
    setOvConfirm('')
  }

  async function submitOverride(clear: boolean) {
    if (!ovOrg) return
    setOvBusy(true)
    try {
      let limitBytes: number | null
      if (clear) {
        limitBytes = null
      } else {
        const mb = Number(ovMb)
        if (!Number.isFinite(mb) || mb <= 0) {
          flash('Enter a positive MB value, or use Clear')
          setOvBusy(false)
          return
        }
        limitBytes = Math.floor(mb * 1024 * 1024)
      }
      const res = await fetch('/api/v1/admin/system/storage/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: ovOrg, limitBytes, confirm: ovConfirm }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to save override')
      flash(clear ? 'Limit cleared' : 'Limit saved')
      setOvOrg('')
      setOvOrgName('')
      setOvMb('')
      setOvConfirm('')
      load(planFilter)
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Failed to save override')
    } finally {
      setOvBusy(false)
    }
  }

  async function deleteOrphan(path: string) {
    if (delConfirm[path] !== path) {
      flash('Type the full path to confirm deletion')
      return
    }
    setDelBusy(path)
    try {
      const res = await fetch('/api/v1/admin/system/storage/orphans', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, confirm: delConfirm[path] }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to delete')
      flash('Orphan deleted')
      setDelConfirm((c) => {
        const next = { ...c }
        delete next[path]
        return next
      })
      loadOrphans()
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setDelBusy(null)
    }
  }

  const typeRows = useMemo(() => {
    if (!data) return []
    const total = Math.max(1, Object.values(data.byType).reduce((a, b) => a + b, 0))
    return Object.entries(data.byType)
      .sort((a, b) => b[1] - a[1])
      .map(([type, bytes]) => ({ type, bytes, pct: (bytes / total) * 100 }))
  }, [data])

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-medium">
            <span aria-hidden="true" className="">
              <Icon name="database" />
            </span>
            Storage Usage
          </h1>
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            File usage across the platform, aggregated from the <code>uploads</code> and{' '}
            <code>social_media</code> collections.
          </p>
        </div>
        <button
          className="rounded-lg border border-[var(--color-pib-line-strong)] px-3 py-1.5 text-sm hover:bg-surface-variant"
          onClick={() => {
            load(planFilter)
            loadOrphans()
          }}
        >
          <Icon name="refresh" /> Refresh
        </button>
      </div>

      {toast && (
        <div className="rounded-lg bg-[var(--color-pib-text)] px-4 py-2 text-sm text-surface shadow">{toast}</div>
      )}

      {/* Header cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {loading ? (
          <>
            <Skeleton className="h-24 rounded-[6px]" />
            <Skeleton className="h-24 rounded-[6px]" />
            <Skeleton className="h-24 rounded-[6px]" />
          </>
        ) : data ? (
          <>
            <div className="st-panel p-4">
              <div className="text-xs uppercase text-[var(--color-pib-text-muted)]">Total usage</div>
              <div className="mt-1 text-2xl font-medium">{formatBytes(data.totalBytes)}</div>
            </div>
            <div className="st-panel p-4">
              <div className="text-xs uppercase text-[var(--color-pib-text-muted)]">Total files</div>
              <div className="mt-1 text-2xl font-medium">{data.totalFiles.toLocaleString()}</div>
            </div>
            <div className="st-panel p-4">
              <div className="text-xs uppercase text-[var(--color-pib-text-muted)]">Organisations</div>
              <div className="mt-1 text-2xl font-medium">{data.byOrg.length.toLocaleString()}</div>
            </div>
          </>
        ) : null}
      </div>

      {error && <div className="rounded-lg bg-error-container px-4 py-2 text-sm text-on-error-container">{error}</div>}

      {data?.capped && (
        <div className="rounded-lg border border-[var(--color-pib-line-strong)] bg-surface-variant px-4 py-2 text-xs text-[var(--color-pib-text-muted)]">
          Showing a capped slice of {data.cap.toLocaleString()} docs per collection - totals are a lower
          bound, not the full bucket.
        </div>
      )}

      {/* By file type */}
      <div className="st-panel p-4">
        <h2 className="mb-3 text-lg font-medium">By file type</h2>
        {loading ? (
          <Skeleton className="h-32 rounded-lg" />
        ) : typeRows.length === 0 ? (
          <p className="text-sm text-[var(--color-pib-text-muted)]">No files found.</p>
        ) : (
          <div className="space-y-2">
            {typeRows.map((row) => (
              <div key={row.type} className="flex items-center gap-3">
                <div className="w-24 shrink-0 text-sm capitalize">{row.type}</div>
                <div className="h-3 flex-1 overflow-hidden rounded bg-surface-variant">
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${row.pct}%`,
                      backgroundColor: TYPE_COLORS[row.type] ?? TYPE_COLORS.unknown,
                    }}
                  />
                </div>
                <div className="w-28 shrink-0 text-right text-sm tabular-nums">{formatBytes(row.bytes)}</div>
                <div className="w-14 shrink-0 text-right text-xs text-[var(--color-pib-text-muted)] tabular-nums">
                  {row.pct.toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Per-org table */}
      <div className="st-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">Usage by organisation</h2>
          {data && data.plans.length > 0 && (
            <select
              className="rounded-lg border border-[var(--color-pib-line-strong)] bg-surface px-2 py-1 text-sm"
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value)}
              aria-label="Filter by plan"
            >
              <option value="">All plans</option>
              {data.plans.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
        </div>
        {loading ? (
          <Skeleton className="h-40 rounded-lg" />
        ) : !data || data.byOrg.length === 0 ? (
          <p className="text-sm text-[var(--color-pib-text-muted)]">No organisations with stored files.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-[var(--color-pib-text-muted)]">
                  <th className="py-2 pr-3">Organisation</th>
                  <th className="py-2 pr-3">Plan</th>
                  <th className="py-2 pr-3 text-right">Files</th>
                  <th className="py-2 pr-3 text-right">Usage</th>
                  <th className="py-2 pr-3 text-right">Limit</th>
                  {isSuperAdmin && <th className="py-2 pr-3" />}
                </tr>
              </thead>
              <tbody>
                {data.byOrg.map((row) => {
                  const overLimit = row.limitBytes != null && row.bytes > row.limitBytes
                  return (
                    <tr key={row.orgId} className="border-t border-[var(--color-pib-line)]">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{row.name}</div>
                        {row.slug && <div className="text-xs text-[var(--color-pib-text-muted)]">{row.slug}</div>}
                      </td>
                      <td className="py-2 pr-3">{row.plan ?? '-'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.files.toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatBytes(row.bytes)}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${overLimit ? 'text-error font-medium' : ''}`}>
                        {row.limitBytes != null ? formatBytes(row.limitBytes) : '-'}
                      </td>
                      {isSuperAdmin && (
                        <td className="py-2 pr-3 text-right">
                          <button
                            className="rounded border border-[var(--color-pib-line-strong)] px-2 py-1 text-xs hover:bg-surface-variant"
                            onClick={() => selectOrgForOverride(row)}
                          >
                            Set limit
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Override form (super-admin) */}
      {isSuperAdmin && (
        <div className="st-panel p-4">
          <h2 className="mb-3 text-lg font-medium">Set storage limit override</h2>
          {!ovOrg ? (
            <p className="text-sm text-[var(--color-pib-text-muted)]">
              Click <strong>Set limit</strong> on an organisation row above to configure its storage cap.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="text-sm">
                Org: <strong>{ovOrgName}</strong>{' '}
                <span className="text-[var(--color-pib-text-muted)]">({ovOrg})</span>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm">
                  <div className="mb-1 text-xs text-[var(--color-pib-text-muted)]">Limit (MB)</div>
                  <input
                    type="number"
                    min="0"
                    className="w-40 rounded-lg border border-[var(--color-pib-line-strong)] bg-surface px-2 py-1.5"
                    value={ovMb}
                    onChange={(e) => setOvMb(e.target.value)}
                    placeholder="e.g. 5000"
                  />
                </label>
                <label className="text-sm">
                  <div className="mb-1 text-xs text-[var(--color-pib-text-muted)]">Type orgId to confirm</div>
                  <input
                    className="w-64 rounded-lg border border-[var(--color-pib-line-strong)] bg-surface px-2 py-1.5"
                    value={ovConfirm}
                    onChange={(e) => setOvConfirm(e.target.value)}
                    placeholder={ovOrg}
                  />
                </label>
                <button
                  className="rounded-lg bg-primary px-3 py-2 text-sm text-on-primary disabled:opacity-50"
                  disabled={ovBusy || ovConfirm !== ovOrg}
                  onClick={() => submitOverride(false)}
                >
                  {ovBusy ? 'Saving…' : 'Save limit'}
                </button>
                <button
                  className="rounded-lg border border-[var(--color-pib-line-strong)] px-3 py-2 text-sm disabled:opacity-50"
                  disabled={ovBusy || ovConfirm !== ovOrg}
                  onClick={() => submitOverride(true)}
                >
                  Clear limit
                </button>
                <button
                  className="rounded-lg px-3 py-2 text-sm text-[var(--color-pib-text-muted)] hover:bg-surface-variant"
                  onClick={() => {
                    setOvOrg('')
                    setOvOrgName('')
                    setOvMb('')
                    setOvConfirm('')
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Orphans */}
      <div className="st-panel p-4">
        <h2 className="mb-3 text-lg font-medium">Orphaned files</h2>
        {orphansLoading ? (
          <Skeleton className="h-24 rounded-lg" />
        ) : orphansError ? (
          <div className="rounded-lg bg-error-container px-4 py-2 text-sm text-on-error-container">
            {orphansError}
          </div>
        ) : orphans && !orphans.storageAvailable ? (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--color-pib-line-strong)] bg-surface-variant px-4 py-3 text-sm text-[var(--color-pib-text-muted)]">
            <span aria-hidden="true" className="!h-7 !w-7 rounded-md">
              <Icon name="info" />
            </span>
            <div>
              <div className="font-medium">Storage enumeration unavailable</div>
              <div>{orphans.note || 'Requires Storage admin access.'}</div>
            </div>
          </div>
        ) : orphans ? (
          <div className="space-y-5">
            <div className="text-xs text-[var(--color-pib-text-muted)]">
              Scanned {orphans.scanned.toLocaleString()} Storage objects (cap {orphans.scanCap.toLocaleString()}).
              {orphans.truncated && ' Scan was truncated - missing-blob detection below is not exhaustive.'}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium">
                Orphaned storage objects ({orphans.orphans.length})
                <span className="ml-1 font-normal text-[var(--color-pib-text-muted)]">- blobs with no uploads record</span>
              </h3>
              {orphans.orphans.length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">None found.</p>
              ) : (
                <div className="space-y-2">
                  {orphans.orphans.map((o) => (
                    <div
                      key={o.path}
                      className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-xs">{o.path}</div>
                        <div className="text-xs text-[var(--color-pib-text-muted)]">
                          {formatBytes(o.sizeBytes)}
                          {o.updated ? ` · updated ${new Date(o.updated).toLocaleString()}` : ''}
                        </div>
                      </div>
                      {isSuperAdmin && (
                        <div className="flex items-center gap-2">
                          <input
                            className="w-56 rounded border border-[var(--color-pib-line-strong)] bg-surface px-2 py-1 text-xs"
                            placeholder="Type path to confirm"
                            value={delConfirm[o.path] ?? ''}
                            onChange={(e) =>
                              setDelConfirm((c) => ({ ...c, [o.path]: e.target.value }))
                            }
                            aria-label={`Confirm delete path for ${o.path}`}
                          />
                          <button
                            className="rounded border border-error px-2 py-1 text-xs text-error hover:bg-error-container disabled:opacity-50"
                            disabled={delBusy === o.path || delConfirm[o.path] !== o.path}
                            onClick={() => deleteOrphan(o.path)}
                          >
                            {delBusy === o.path ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium">
                Missing blobs ({orphans.missingBlobs.length})
                <span className="ml-1 font-normal text-[var(--color-pib-text-muted)]">
                  - uploads records whose Storage blob is gone
                </span>
              </h3>
              {orphans.truncated && (
                <p className="mb-2 text-xs text-[var(--color-pib-text-muted)]">
                  Note: scan was truncated, so this list may include records whose blobs simply weren&apos;t in
                  the scanned page. Treat as advisory.
                </p>
              )}
              {orphans.missingBlobs.length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">None found.</p>
              ) : (
                <div className="space-y-1">
                  {orphans.missingBlobs.map((m) => (
                    <div
                      key={m.id}
                      className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2 text-xs"
                    >
                      <div className="font-mono">{m.storagePath}</div>
                      <div className="text-[var(--color-pib-text-muted)]">
                        doc {m.id}
                        {m.orgId ? ` · org ${m.orgId}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
