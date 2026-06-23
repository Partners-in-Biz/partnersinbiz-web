// app/(portal)/portal/settings/sessions/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'

type SessionRow = {
  id: string
  userAgent: string
  ip: string
  createdAt: number | null
  lastSeenAt: number | null
  current: boolean
  revoked: boolean
}

type HistoryRow = {
  id: string
  userAgent: string
  ip: string
  event: string
  at: number | null
}

function unwrap(body: unknown): Record<string, unknown> {
  const b = body as { data?: Record<string, unknown> } & Record<string, unknown>
  return (b?.data ?? b) ?? {}
}

function fmt(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function deviceLabel(ua: string): string {
  if (!ua || ua === 'Unknown device') return 'Unknown device'
  const browser = /Edg/.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${browser} on ${os}` : browser
}

export default function SessionsSettingsPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [revokingAll, setRevokingAll] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await fetch('/api/v1/account/sessions')
      const data = unwrap(await res.json().catch(() => ({})))
      if (!res.ok) throw new Error((data.error as string) ?? 'Failed to load sessions')
      setSessions(Array.isArray(data.sessions) ? (data.sessions as SessionRow[]) : [])
      setHistory(Array.isArray(data.loginHistory) ? (data.loginHistory as HistoryRow[]) : [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function revokeOne(id: string) {
    setBusyId(id)
    setError('')
    try {
      const res = await fetch(`/api/v1/account/sessions/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = unwrap(await res.json().catch(() => ({})))
        throw new Error((data.error as string) ?? 'Failed to revoke session')
      }
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to revoke session')
    } finally {
      setBusyId(null)
    }
  }

  async function revokeAll() {
    setRevokingAll(true)
    setError('')
    try {
      const res = await fetch('/api/v1/account/sessions', { method: 'DELETE' })
      if (!res.ok) {
        const data = unwrap(await res.json().catch(() => ({})))
        throw new Error((data.error as string) ?? 'Failed to revoke sessions')
      }
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to revoke sessions')
    } finally {
      setRevokingAll(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <p className="eyebrow">Portal settings</p>
        <h1 className="pib-page-title mt-2">Sessions &amp; devices</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
          Review where your account is signed in. Revoking all other sessions forces every other device to sign in again.
        </p>
      </div>

      {error && <p className="text-xs text-red-400" role="alert">{error}</p>}

      <section data-testid="sessions-panel" className="pib-card-section">
        <div className="pib-card-section-header flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Active sessions</p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">Where you&apos;re signed in</h2>
          </div>
          <button
            type="button"
            onClick={revokeAll}
            disabled={revokingAll}
            className="shrink-0 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
          >
            {revokingAll ? 'Revoking…' : 'Revoke all other sessions'}
          </button>
        </div>

        <div className="divide-y divide-[var(--color-pib-line)]">
          {loading ? (
            <p className="p-5 text-sm text-[var(--color-pib-text-muted)]">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="p-5 text-sm text-[var(--color-pib-text-muted)]">No session records yet.</p>
          ) : (
            sessions.map((s) => (
              <div key={s.id} data-testid={`session-row-${s.id}`} className="flex items-center justify-between gap-4 p-5 max-sm:flex-col max-sm:items-start">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="material-symbols-outlined mt-0.5 rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-2 text-[20px] text-[var(--color-pib-accent)]" aria-hidden="true">
                    {/Mobile|iPhone|Android/.test(s.userAgent) ? 'smartphone' : 'computer'}
                  </span>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-[var(--color-pib-text)]">{deviceLabel(s.userAgent)}</p>
                      {s.current && <span className="pib-pill pib-pill-success">This device</span>}
                      {s.revoked && <span className="pib-pill">Revoked</span>}
                    </div>
                    <p className="text-xs text-[var(--color-pib-text-muted)]">IP {s.ip} · Last seen {fmt(s.lastSeenAt)}</p>
                    <p className="truncate text-xs text-[var(--color-pib-text-muted)]" title={s.userAgent}>{s.userAgent}</p>
                  </div>
                </div>
                {!s.current && !s.revoked && (
                  <button
                    type="button"
                    onClick={() => revokeOne(s.id)}
                    disabled={busyId === s.id}
                    className="shrink-0 rounded-lg border border-[var(--color-pib-line)] px-3 py-1.5 text-xs font-medium text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)] disabled:opacity-50"
                  >
                    {busyId === s.id ? 'Revoking…' : 'Revoke'}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section data-testid="login-history-panel" className="pib-card-section">
        <div className="pib-card-section-header">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Login history</p>
          <h2 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">Recent activity</h2>
        </div>
        <div className="divide-y divide-[var(--color-pib-line)]">
          {loading ? (
            <p className="p-5 text-sm text-[var(--color-pib-text-muted)]">Loading…</p>
          ) : history.length === 0 ? (
            <p className="p-5 text-sm text-[var(--color-pib-text-muted)]">No login history recorded yet.</p>
          ) : (
            history.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="text-sm text-[var(--color-pib-text)]">{h.event === 'login' ? deviceLabel(h.userAgent) : h.event.replace(/_/g, ' ')}</p>
                  <p className="text-xs text-[var(--color-pib-text-muted)]">{h.ip ? `IP ${h.ip} · ` : ''}{fmt(h.at)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <p className="text-sm text-[var(--color-pib-text-muted)]">
        Set up two-factor authentication on the{' '}
        <a href="/portal/settings/security" className="text-[var(--color-pib-accent)] hover:underline">Security</a> page.
      </p>
    </div>
  )
}
