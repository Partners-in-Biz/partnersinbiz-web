// app/(portal)/portal/settings/sessions/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/AppFoundation'
import { Button, ButtonLink, Icon, Notice, Panel, Status, Title, Toolbar } from '@/components/studio'

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
  if (!ms) return '-'
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
      <PageHeader
        title="Sessions and devices."
        description="Review where your account is signed in. Revoking all other sessions forces every other device to sign in again."
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <section data-testid="sessions-panel"><Panel className="pib-card-section !p-0 overflow-hidden">
        <Toolbar className="pib-card-section-header border-b border-[var(--sc-line)] px-5 py-4">
          <div>
            <p className="sc-tiny">Active sessions</p>
            <Title className="mt-2">Where you are signed in</Title>
          </div>
          <Button type="button" variant="danger" size="sm" onClick={revokeAll} loading={revokingAll}>
            Revoke all other sessions
          </Button>
        </Toolbar>

        <div className="divide-y divide-[var(--sc-line)]">
          {loading ? (
            <p className="sc-body p-5 text-[var(--sc-ink-soft)]">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="sc-body p-5 text-[var(--sc-ink-soft)]">No session records yet.</p>
          ) : (
            sessions.map((s) => (
              <div key={s.id} data-testid={`session-row-${s.id}`} className="flex items-center justify-between gap-4 p-5 max-sm:flex-col max-sm:items-start">
                <div className="flex min-w-0 items-start gap-4">
                  <Icon name={/Mobile|iPhone|Android/.test(s.userAgent) ? 'smartphone' : 'computer'} />
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm text-[var(--sc-ink)]">{deviceLabel(s.userAgent)}</p>
                      {s.current ? <Status tone="success">This device</Status> : null}
                      {s.revoked ? <Status>Revoked</Status> : null}
                    </div>
                    <p className="sc-body text-[0.75rem] text-[var(--sc-ink-soft)]">IP {s.ip} · Last seen {fmt(s.lastSeenAt)}</p>
                    <p className="truncate text-[0.75rem] text-[var(--sc-ink-soft)]" title={s.userAgent}>{s.userAgent}</p>
                  </div>
                </div>
                {!s.current && !s.revoked ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => revokeOne(s.id)}
                    loading={busyId === s.id}
                  >
                    Revoke
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Panel></section>

      <section data-testid="login-history-panel"><Panel className="pib-card-section !p-0 overflow-hidden">
        <div className="pib-card-section-header px-5 py-4">
          <p className="sc-tiny">Login history</p>
          <Title className="mt-2">Recent activity</Title>
        </div>
        <div className="divide-y divide-[var(--sc-line)]">
          {loading ? (
            <p className="sc-body p-5 text-[var(--sc-ink-soft)]">Loading…</p>
          ) : history.length === 0 ? (
            <p className="sc-body p-5 text-[var(--sc-ink-soft)]">No login history recorded yet.</p>
          ) : (
            history.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="text-sm text-[var(--sc-ink)]">{h.event === 'login' ? deviceLabel(h.userAgent) : h.event.replace(/_/g, ' ')}</p>
                  <p className="sc-body text-[0.75rem] text-[var(--sc-ink-soft)]">{h.ip ? `IP ${h.ip} · ` : ''}{fmt(h.at)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </Panel></section>

      <p className="sc-body text-[var(--sc-ink-soft)]">
        Set up two-factor authentication on the{' '}
        <ButtonLink href="/portal/settings/security" variant="ghost" size="sm">Security</ButtonLink>
        {' '}page.
      </p>
    </div>
  )
}
