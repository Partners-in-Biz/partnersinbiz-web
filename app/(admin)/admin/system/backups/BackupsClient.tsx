'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

interface OrgRow {
  id: string
  name: string
  slug: string
}

interface BackupRow {
  id: string
  orgId: string
  status: string
  collections: string[]
  storagePath: string | null
  downloadUrl: string | null
  sizeBytes: number | null
  docCount: number | null
  createdBy: string
  createdByName: string
  storageFallback: boolean
  error: string | null
  createdAt: string | null
  finishedAt: string | null
}

interface DiffResult {
  orgId: string
  perCollection: Record<string, { added: number; removed: number; changed: number; unchanged: number }>
  totals: { added: number; removed: number; changed: number; unchanged: number }
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function unwrap<T>(body: { data?: T } & Record<string, unknown>): T {
  return (body.data ?? body) as T
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    running: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    pending: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
    failed: 'bg-red-500/10 text-red-400 border-red-500/30',
  }
  const cls = map[status] ?? 'bg-slate-500/10 text-slate-400 border-slate-500/30'
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-label ${cls}`}>
      {status}
    </span>
  )
}

export default function BackupsClient() {
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [backups, setBackups] = useState<BackupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [topError, setTopError] = useState<string | null>(null)

  const [selectedOrg, setSelectedOrg] = useState<string>('')

  // create modal
  const [showCreate, setShowCreate] = useState(false)
  const [confirmCreate, setConfirmCreate] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // diff panel
  const [diffFor, setDiffFor] = useState<string | null>(null)
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)

  // restore modal
  const [restoreFor, setRestoreFor] = useState<string | null>(null)
  const [confirmRestore, setConfirmRestore] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [restoreResult, setRestoreResult] = useState<string | null>(null)

  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const orgNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of orgs) m.set(o.id, o.name)
    return m
  }, [orgs])

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/verify')
      .then((r) => r.json())
      .then((body) => {
        if (!cancelled) setIsSuperAdmin(Boolean(body?.isSuperAdmin))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setTopError(null)
    try {
      const res = await fetch('/api/v1/admin/system/backups')
      const body = await res.json()
      if (!res.ok) {
        setTopError(body?.error ?? 'Failed to load backups')
        return
      }
      const data = unwrap<{ backups: BackupRow[]; orgs: OrgRow[] }>(body)
      setBackups(Array.isArray(data.backups) ? data.backups : [])
      setOrgs(Array.isArray(data.orgs) ? data.orgs : [])
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to load backups')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const visibleBackups = useMemo(() => {
    if (!selectedOrg) return backups
    return backups.filter((b) => b.orgId === selectedOrg)
  }, [backups, selectedOrg])

  const createBackup = useCallback(async () => {
    if (!selectedOrg) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/v1/admin/system/backups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId: selectedOrg, confirm: confirmCreate.trim() }),
      })
      const body = await res.json()
      if (!res.ok) {
        setCreateError(body?.error ?? 'Backup failed')
        return
      }
      setShowCreate(false)
      setConfirmCreate('')
      await load()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Backup failed')
    } finally {
      setCreating(false)
    }
  }, [selectedOrg, confirmCreate, load])

  const runDiff = useCallback(async (id: string) => {
    setDiffFor(id)
    setDiff(null)
    setDiffError(null)
    setDiffLoading(true)
    try {
      const res = await fetch(`/api/v1/admin/system/backups/${id}/diff`)
      const body = await res.json()
      if (!res.ok) {
        setDiffError(body?.error ?? 'Diff failed')
        return
      }
      setDiff(unwrap<DiffResult>(body))
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : 'Diff failed')
    } finally {
      setDiffLoading(false)
    }
  }, [])

  const download = useCallback(async (id: string) => {
    setDownloadingId(id)
    setRowError(null)
    try {
      const res = await fetch(`/api/v1/admin/system/backups/${id}/download`)
      const contentType = res.headers.get('content-type') ?? ''
      if (!res.ok && contentType.includes('application/json')) {
        const body = await res.json()
        // a JSON error envelope (has success:false / error) vs a signed-url payload
        if (body && body.success === false) {
          setRowError(body?.error ?? 'Download failed')
          return
        }
      }
      // If the response is a JSON envelope carrying a signed URL, open it.
      const disposition = res.headers.get('content-disposition') ?? ''
      if (contentType.includes('application/json') && !disposition) {
        const body = await res.json()
        const data = unwrap<{ url?: string }>(body)
        if (data?.url) {
          window.open(data.url, '_blank', 'noopener')
          return
        }
      }
      // Otherwise it's a streamed file download — turn it into a blob.
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `backup-${id}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setDownloadingId(null)
    }
  }, [])

  const runRestore = useCallback(async () => {
    if (!restoreFor) return
    setRestoring(true)
    setRestoreError(null)
    setRestoreResult(null)
    try {
      const res = await fetch(`/api/v1/admin/system/backups/${restoreFor}/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: confirmRestore.trim() }),
      })
      const body = await res.json()
      if (!res.ok) {
        setRestoreError(body?.error ?? 'Restore failed')
        return
      }
      const data = unwrap<{ restoredCount: number; collections: string[] }>(body)
      setRestoreResult(`Restored ${data.restoredCount} documents across ${data.collections.length} collections.`)
      setConfirmRestore('')
      await load()
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      setRestoring(false)
    }
  }, [restoreFor, confirmRestore, load])

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Platform / System
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Per-Org Backups</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Create point-in-time JSON snapshots of an organisation&apos;s scoped data, diff a snapshot
            against live Firestore, download it, or restore (upsert) it back into production.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isSuperAdmin && (
            <button
              onClick={() => {
                setCreateError(null)
                setConfirmCreate('')
                setShowCreate(true)
              }}
              disabled={!selectedOrg}
              className="pib-btn-primary text-sm font-label flex items-center gap-1.5 disabled:opacity-50"
              title={selectedOrg ? 'Create backup' : 'Pick an org first'}
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              Create backup
            </button>
          )}
          <button
            onClick={() => load()}
            className="pib-btn-ghost text-sm font-label flex items-center gap-1.5"
            title="Refresh"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            Refresh
          </button>
        </div>
      </div>

      {/* Org picker */}
      <div className="pib-card p-4 flex flex-wrap items-center gap-3">
        <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">Organisation</span>
        <select
          className="pib-input text-sm min-w-[260px]"
          value={selectedOrg}
          onChange={(e) => setSelectedOrg(e.target.value)}
        >
          <option value="">All organisations</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}{o.slug ? ` (${o.slug})` : ''}
            </option>
          ))}
        </select>
        {selectedOrg && (
          <span className="text-xs text-on-surface-variant font-mono">{selectedOrg}</span>
        )}
      </div>

      {topError && (
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {topError}
        </div>
      )}
      {rowError && (
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {rowError}
        </div>
      )}

      {/* Backups table */}
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : visibleBackups.length === 0 ? (
        <div className="pib-card p-10 text-center text-sm text-on-surface-variant">
          No backups yet{selectedOrg ? ' for this organisation' : ''}.
          {isSuperAdmin && selectedOrg && ' Use “Create backup” above to make one.'}
        </div>
      ) : (
        <div className="pib-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-outline/40 text-left text-[10px] font-label uppercase tracking-wide text-on-surface-variant">
                  <th className="px-4 py-2">Organisation</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2 text-right">Docs</th>
                  <th className="px-4 py-2 text-right">Size</th>
                  <th className="px-4 py-2">Created</th>
                  <th className="px-4 py-2">By</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleBackups.map((b) => (
                  <tr key={b.id} className="border-b border-outline/20 last:border-0 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium text-on-surface">{orgNameById.get(b.orgId) ?? b.orgId}</div>
                      <div className="text-xs text-on-surface-variant font-mono">{b.orgId}</div>
                      {b.storageFallback && (
                        <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-label text-amber-400">
                          <span className="material-symbols-outlined text-[12px]">database</span>
                          Firestore fallback
                        </span>
                      )}
                      {b.error && <div className="text-xs text-red-400 mt-1">{b.error}</div>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                    <td className="px-4 py-3 text-right tabular-nums">{b.docCount ?? '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatBytes(b.sizeBytes)}</td>
                    <td className="px-4 py-3 text-xs text-on-surface-variant whitespace-nowrap">{formatDate(b.createdAt)}</td>
                    <td className="px-4 py-3 text-xs text-on-surface-variant">{b.createdByName || b.createdBy || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => runDiff(b.id)}
                          className="pib-btn-ghost text-xs font-label flex items-center gap-1"
                          title="Diff against live"
                        >
                          <span className="material-symbols-outlined text-[14px]">difference</span>
                          Diff
                        </button>
                        {isSuperAdmin && (
                          <button
                            onClick={() => download(b.id)}
                            disabled={downloadingId === b.id || b.status !== 'completed'}
                            className="pib-btn-ghost text-xs font-label flex items-center gap-1 disabled:opacity-40"
                            title="Download JSON"
                          >
                            <span className="material-symbols-outlined text-[14px]">download</span>
                            {downloadingId === b.id ? '…' : 'Download'}
                          </button>
                        )}
                        {isSuperAdmin && (
                          <button
                            onClick={() => {
                              setRestoreError(null)
                              setRestoreResult(null)
                              setConfirmRestore('')
                              setRestoreFor(b.id)
                            }}
                            disabled={b.status !== 'completed'}
                            className="pib-btn-ghost text-xs font-label flex items-center gap-1 text-amber-400 disabled:opacity-40"
                            title="Restore into live Firestore"
                          >
                            <span className="material-symbols-outlined text-[14px]">restore</span>
                            Restore
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Diff panel */}
      {diffFor && (
        <div className="pib-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-headline font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">difference</span>
              Diff vs live — <span className="font-mono text-xs">{diffFor}</span>
            </h2>
            <button onClick={() => { setDiffFor(null); setDiff(null) }} className="pib-btn-ghost text-xs font-label">
              Close
            </button>
          </div>
          {diffLoading ? (
            <Skeleton className="h-32 w-full rounded-lg" />
          ) : diffError ? (
            <div className="text-sm text-red-400">{diffError}</div>
          ) : diff ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-outline/40 text-left text-[10px] font-label uppercase tracking-wide text-on-surface-variant">
                    <th className="px-3 py-2">Collection</th>
                    <th className="px-3 py-2 text-right">Added (live only)</th>
                    <th className="px-3 py-2 text-right">Removed (backup only)</th>
                    <th className="px-3 py-2 text-right">Changed</th>
                    <th className="px-3 py-2 text-right">Unchanged</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(diff.perCollection).map(([name, c]) => (
                    <tr key={name} className="border-b border-outline/20 last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">{name}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-400">{c.added}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-400">{c.removed}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-400">{c.changed}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-on-surface-variant">{c.unchanged}</td>
                    </tr>
                  ))}
                  <tr className="bg-surface-variant/30 font-medium">
                    <td className="px-3 py-2">Totals</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-400">{diff.totals.added}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-400">{diff.totals.removed}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-400">{diff.totals.changed}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-on-surface-variant">{diff.totals.unchanged}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="pib-card w-full max-w-md p-5 space-y-4">
            <h2 className="text-lg font-headline font-bold text-on-surface">Create backup</h2>
            <p className="text-sm text-on-surface-variant">
              This snapshots the scoped collections for{' '}
              <span className="font-medium text-on-surface">{orgNameById.get(selectedOrg) ?? selectedOrg}</span>.
              To confirm, type the org id below:
            </p>
            <code className="block rounded bg-surface-variant/40 px-2 py-1 text-xs font-mono text-on-surface">{selectedOrg}</code>
            <input
              className="pib-input w-full text-sm font-mono"
              value={confirmCreate}
              onChange={(e) => setConfirmCreate(e.target.value)}
              placeholder="Type the org id to confirm"
              autoFocus
            />
            {createError && <div className="text-sm text-red-400">{createError}</div>}
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="pib-btn-ghost text-sm font-label" disabled={creating}>
                Cancel
              </button>
              <button
                onClick={createBackup}
                disabled={creating || confirmCreate.trim() !== selectedOrg}
                className="pib-btn-primary text-sm font-label flex items-center gap-1.5 disabled:opacity-50"
              >
                {creating && <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>}
                {creating ? 'Backing up…' : 'Create backup'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore modal */}
      {restoreFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="pib-card w-full max-w-md p-5 space-y-4">
            <h2 className="text-lg font-headline font-bold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-amber-400">restore</span>
              Restore backup
            </h2>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
              This <strong>upserts</strong> every document from the backup back into live Firestore (merge). It does
              not delete anything, but it will overwrite fields that changed since the snapshot. This cannot be undone.
            </div>
            <p className="text-sm text-on-surface-variant">To confirm, type the backup id:</p>
            <code className="block rounded bg-surface-variant/40 px-2 py-1 text-xs font-mono text-on-surface">{restoreFor}</code>
            <input
              className="pib-input w-full text-sm font-mono"
              value={confirmRestore}
              onChange={(e) => setConfirmRestore(e.target.value)}
              placeholder="Type the backup id to confirm"
              autoFocus
            />
            {restoreError && <div className="text-sm text-red-400">{restoreError}</div>}
            {restoreResult && <div className="text-sm text-emerald-400">{restoreResult}</div>}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => { setRestoreFor(null); setRestoreResult(null) }}
                className="pib-btn-ghost text-sm font-label"
                disabled={restoring}
              >
                {restoreResult ? 'Close' : 'Cancel'}
              </button>
              {!restoreResult && (
                <button
                  onClick={runRestore}
                  disabled={restoring || confirmRestore.trim() !== restoreFor}
                  className="pib-btn-primary text-sm font-label flex items-center gap-1.5 disabled:opacity-50"
                >
                  {restoring && <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>}
                  {restoring ? 'Restoring…' : 'Restore now'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
