'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface MigrationRun {
  id: string
  migrationId: string
  status: 'running' | 'completed' | 'failed' | 'rolled_back'
  dryRun: boolean
  orgId: string | null
  startedAt: string | null
  finishedAt: string | null
  log: string[]
  itemsProcessed: number
  error: string | null
  triggeredBy?: { uid: string; name: string }
}

interface Migration {
  id: string
  name: string
  description: string
  status: string
  lastRunAt: string | null
  dryRunSupported: boolean
  rollbackSupported: boolean
  requiresOrgId: boolean
  lastRun: MigrationRun | null
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    running: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    failed: 'border-red-500/30 bg-red-500/10 text-red-300',
    rolled_back: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
    idle: 'border-outline/40 bg-surface-variant/30 text-on-surface-variant',
  }
  return map[status] ?? map.idle
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function fmtDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '—'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export default function MigrationsClient() {
  const [migrations, setMigrations] = useState<Migration[]>([])
  const [loading, setLoading] = useState(true)
  const [topError, setTopError] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

  // Run panel state — keyed by migration id (the one currently open).
  const [openId, setOpenId] = useState<string | null>(null)
  const [dryRun, setDryRun] = useState(true)
  const [orgId, setOrgId] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [runError, setRunError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  // Live run polling state.
  const [activeRun, setActiveRun] = useState<MigrationRun | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadMigrations = useCallback(async () => {
    setLoading(true)
    setTopError(null)
    try {
      const res = await fetch('/api/v1/admin/system/migrations')
      const body = await res.json().catch(() => ({}))
      const data = body.data ?? body
      if (!res.ok) {
        setTopError(body?.error ?? 'Failed to load migrations')
        return
      }
      setMigrations(data.migrations ?? [])
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to load migrations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMigrations()
  }, [loadMigrations])

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/verify')
      .then((res) => (res.ok ? res.json() : null))
      .then((session: { isSuperAdmin?: boolean } | null) => {
        if (!cancelled) setIsSuperAdmin(Boolean(session?.isSuperAdmin))
      })
      .catch(() => {
        if (!cancelled) setIsSuperAdmin(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  const pollRun = useCallback(
    (runId: string) => {
      stopPolling()
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/v1/admin/system/migrations/runs/${runId}`)
          const body = await res.json().catch(() => ({}))
          const data = body.data ?? body
          if (res.ok && data.run) {
            setActiveRun(data.run as MigrationRun)
            if (data.run.status !== 'running') {
              stopPolling()
              loadMigrations()
            }
          }
        } catch {
          // transient — keep polling
        }
      }, 1500)
    },
    [stopPolling, loadMigrations],
  )

  function openPanel(m: Migration) {
    setOpenId(m.id)
    setDryRun(true)
    setOrgId('')
    setConfirmText('')
    setRunError(null)
    setActiveRun(null)
    stopPolling()
  }

  function closePanel() {
    setOpenId(null)
    setActiveRun(null)
    stopPolling()
  }

  async function startRun(m: Migration) {
    setStarting(true)
    setRunError(null)
    try {
      const res = await fetch(`/api/v1/admin/system/migrations/${m.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dryRun,
          confirm: confirmText,
          orgId: orgId.trim() || undefined,
        }),
      })
      const body = await res.json().catch(() => ({}))
      const data = body.data ?? body
      if (!res.ok) throw new Error(body?.error || `Run failed (${res.status})`)
      // The run executes synchronously server-side and returns final state, but
      // we still seed the live panel and poll once to render the final record.
      setActiveRun({
        id: data.runId,
        migrationId: m.id,
        status: data.status,
        dryRun,
        orgId: orgId.trim() || null,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        log: data.log ?? [],
        itemsProcessed: data.itemsProcessed ?? 0,
        error: data.status === 'failed' ? (body?.error ?? null) : null,
      })
      pollRun(data.runId)
      loadMigrations()
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Run failed')
    } finally {
      setStarting(false)
    }
  }

  async function rollback(run: MigrationRun) {
    setRunError(null)
    const confirm = window.prompt(`Type the run id to confirm rollback:\n${run.id}`)
    if (confirm == null) return
    try {
      const res = await fetch(`/api/v1/admin/system/migrations/runs/${run.id}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || `Rollback failed (${res.status})`)
      loadMigrations()
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Rollback failed')
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Platform · System
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Migration runner</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Run registered data migrations with a dry-run preview, typed confirmation, and a live log.
            Destructive runs are restricted to super admins.
          </p>
        </div>
        <button
          onClick={() => loadMigrations()}
          className="pib-btn-ghost text-sm font-label flex items-center gap-1.5 shrink-0"
          title="Refresh"
        >
          <span className="material-symbols-outlined text-[16px]">refresh</span>
          Refresh
        </button>
      </div>

      {topError && (
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {topError}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : migrations.length === 0 ? (
        <div className="pib-card p-10 text-center text-sm text-on-surface-variant">
          No migrations registered.
        </div>
      ) : (
        <div className="space-y-4">
          {migrations.map((m) => {
            const lr = m.lastRun
            const isOpen = openId === m.id
            const confirmMatches = confirmText === m.id
            return (
              <div key={m.id} className="pib-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-base font-semibold text-on-surface">{m.name}</h2>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-label uppercase tracking-wide ${statusBadge(m.status)}`}
                      >
                        {m.status}
                      </span>
                      <span className="font-mono text-[10px] text-on-surface-variant/70">{m.id}</span>
                    </div>
                    <p className="text-sm text-on-surface-variant mt-1">{m.description}</p>
                  </div>
                  {isSuperAdmin && (
                    <button
                      onClick={() => (isOpen ? closePanel() : openPanel(m))}
                      className="pib-btn-primary text-sm font-label flex items-center gap-1.5 shrink-0"
                    >
                      <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                      {isOpen ? 'Close' : 'Run'}
                    </button>
                  )}
                </div>

                {/* Last run summary */}
                <div className="rounded-lg border border-outline/40 bg-surface-variant/20 p-3 text-xs text-on-surface-variant grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <div className="uppercase tracking-wide text-[9px] text-on-surface-variant/70">Last run</div>
                    <div className="mt-0.5">
                      {lr ? (
                        <span
                          className={`rounded-full border px-1.5 py-0.5 text-[10px] ${statusBadge(lr.status)}`}
                        >
                          {lr.status}
                          {lr.dryRun ? ' · dry' : ''}
                        </span>
                      ) : (
                        'Never run'
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="uppercase tracking-wide text-[9px] text-on-surface-variant/70">When</div>
                    <div className="mt-0.5">{fmtWhen(lr?.startedAt ?? m.lastRunAt)}</div>
                  </div>
                  <div>
                    <div className="uppercase tracking-wide text-[9px] text-on-surface-variant/70">Duration</div>
                    <div className="mt-0.5">{fmtDuration(lr?.startedAt ?? null, lr?.finishedAt ?? null)}</div>
                  </div>
                  <div>
                    <div className="uppercase tracking-wide text-[9px] text-on-surface-variant/70">Items</div>
                    <div className="mt-0.5">{lr ? lr.itemsProcessed : '—'}</div>
                  </div>
                  {lr?.triggeredBy && (
                    <div className="col-span-2 sm:col-span-4">
                      <div className="uppercase tracking-wide text-[9px] text-on-surface-variant/70">By</div>
                      <div className="mt-0.5">{lr.triggeredBy.name}</div>
                    </div>
                  )}
                </div>

                {/* Rollback (only if supported) */}
                {isSuperAdmin && m.rollbackSupported && lr && lr.status === 'completed' && (
                  <button
                    onClick={() => rollback(lr)}
                    className="pib-btn-ghost text-xs font-label flex items-center gap-1.5 text-red-300"
                  >
                    <span className="material-symbols-outlined text-[14px]">undo</span>
                    Roll back last run
                  </button>
                )}

                {/* Run panel */}
                {isOpen && (
                  <div className="rounded-lg border border-outline/60 bg-surface-variant/30 p-4 space-y-3">
                    <label className="flex items-center gap-2 text-sm text-on-surface cursor-pointer">
                      <input
                        type="checkbox"
                        checked={dryRun}
                        onChange={(e) => setDryRun(e.target.checked)}
                        className="accent-[var(--color-pib-primary,#6366f1)]"
                      />
                      Dry run (preview only — no data changes)
                    </label>

                    <label className="space-y-1 block">
                      <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">
                        Org ID {m.requiresOrgId ? '(required for a live run)' : '(optional)'}
                      </span>
                      <input
                        className="pib-input w-full font-mono text-sm"
                        value={orgId}
                        onChange={(e) => setOrgId(e.target.value)}
                        placeholder="org_xxx — leave empty for an org-wide dry-run count"
                      />
                    </label>

                    <label className="space-y-1 block">
                      <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">
                        Type <span className="font-mono text-on-surface">{m.id}</span> to confirm
                      </span>
                      <input
                        className="pib-input w-full font-mono text-sm"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder={m.id}
                      />
                    </label>

                    {runError && (
                      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
                        {runError}
                      </div>
                    )}

                    <div className="flex justify-end gap-2">
                      <button onClick={closePanel} className="pib-btn-ghost text-xs font-label">
                        Cancel
                      </button>
                      <button
                        onClick={() => startRun(m)}
                        disabled={!confirmMatches || starting}
                        className="pib-btn-primary text-xs font-label disabled:opacity-50"
                      >
                        {starting ? 'Running…' : dryRun ? 'Run dry-run' : 'Run live'}
                      </button>
                    </div>

                    {/* Live log */}
                    {activeRun && (
                      <div className="rounded-lg border border-outline/40 bg-black/30 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-label uppercase tracking-wide ${statusBadge(activeRun.status)}`}
                          >
                            {activeRun.status === 'running' && (
                              <span className="material-symbols-outlined text-[12px] animate-spin mr-1 align-middle">
                                progress_activity
                              </span>
                            )}
                            {activeRun.status}
                          </span>
                          <span className="text-[10px] text-on-surface-variant">
                            {activeRun.itemsProcessed} item(s) processed
                          </span>
                        </div>
                        <pre className="text-[11px] leading-relaxed font-mono text-on-surface-variant whitespace-pre-wrap max-h-64 overflow-auto">
                          {(activeRun.log ?? []).join('\n') || 'No log output.'}
                        </pre>
                        {activeRun.error && (
                          <div className="text-[11px] text-red-300">Error: {activeRun.error}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!isSuperAdmin && !loading && (
        <p className="text-xs text-on-surface-variant">
          You can view migration state. Running and rolling back migrations is restricted to super admins.
        </p>
      )}
    </div>
  )
}
