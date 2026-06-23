'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import HeaderInspector from '@/components/admin/email/HeaderInspector'

type AuthState = 'verified' | 'pending' | 'failed' | 'missing'

interface DomainAuthRow {
  id: string
  orgId: string
  name: string
  status: string
  spf: AuthState
  dkim: AuthState
  dmarc: AuthState
  region: string
  lastSyncedAt: string | null
}

interface WebhookEventRow {
  emailId: string
  resendId: string
  orgId: string
  to: string
  subject: string
  event: string
  at: string | null
}

interface Controls {
  pauseOutbound: boolean
  pauseReason: string | null
  pausedBy: string | null
  pausedAt: string | null
}

interface Payload {
  windowDays: number
  domains: DomainAuthRow[]
  metrics: {
    sent: number
    delivered: number
    bounced: number
    complained: number
    bounceRatePct: number
    complaintRatePct: number
  }
  events: WebhookEventRow[]
  controls: Controls
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

const AUTH_BADGE: Record<AuthState, { label: string; cls: string }> = {
  verified: { label: 'Pass', cls: 'bg-green-500/10 text-green-400 border-green-500/30' },
  pending: { label: 'Pending', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  failed: { label: 'Fail', cls: 'bg-red-500/10 text-red-400 border-red-500/30' },
  missing: { label: 'Missing', cls: 'bg-on-surface/10 text-on-surface-variant border-on-surface/20' },
}

function AuthBadge({ state }: { state: AuthState }) {
  const b = AUTH_BADGE[state]
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-label ${b.cls}`}>
      {b.label}
    </span>
  )
}

const EVENT_CLS: Record<string, string> = {
  delivered: 'text-green-400',
  opened: 'text-sky-400',
  clicked: 'text-violet-400',
  bounced: 'text-red-400',
  failed: 'text-red-400',
  complained: 'text-orange-400',
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export default function EmailDeliverabilityPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [savingPause, setSavingPause] = useState(false)

  // Suppression removal
  const [supOrg, setSupOrg] = useState('')
  const [supEmail, setSupEmail] = useState('')
  const [removing, setRemoving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/email/deliverability')
      const body = await res.json()
      if (!res.ok) {
        setError(body?.error ?? 'Failed to load deliverability data')
        setData(null)
      } else {
        setData(body.data as Payload)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function togglePause() {
    if (!data) return
    setSavingPause(true)
    setNotice(null)
    setError(null)
    try {
      const next = !data.controls.pauseOutbound
      const res = await fetch('/api/v1/admin/email/controls', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pauseOutbound: next }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to update controls')
      setData((prev) => (prev ? { ...prev, controls: body.data } : prev))
      setNotice(next ? 'Outbound email PAUSED platform-wide.' : 'Outbound email resumed.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update controls')
    } finally {
      setSavingPause(false)
    }
  }

  async function removeSuppression(e: React.FormEvent) {
    e.preventDefault()
    if (!supOrg.trim() || !supEmail.trim()) return
    setRemoving(true)
    setNotice(null)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/email/suppressions', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId: supOrg.trim(), email: supEmail.trim() }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to remove suppression')
      setNotice(`Removed ${supEmail.trim()} from suppression list for ${supOrg.trim()}.`)
      setSupEmail('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove suppression')
    } finally {
      setRemoving(false)
    }
  }

  const m = data?.metrics
  const bounceWarn = (m?.bounceRatePct ?? 0) >= 4
  const complaintWarn = (m?.complaintRatePct ?? 0) >= 0.3

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Platform / Email
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Email Deliverability</h1>
          <p className="text-sm text-on-surface-variant mt-0.5 max-w-2xl">
            Live SPF / DKIM / DMARC status per sending domain, bounce &amp; complaint rates from the
            real send log, the recent event stream, and a platform-wide pause switch.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start md:self-auto">
          <Link href="/admin/email/domains" className="pib-btn-ghost text-sm font-label">
            Domain rules
          </Link>
          <Link href="/admin/email/broadcast" className="pib-btn-ghost text-sm font-label">
            Broadcast
          </Link>
          <Link href="/admin/email/templates" className="pib-btn-ghost text-sm font-label">
            Templates
          </Link>
          <button onClick={load} disabled={loading} className="pib-btn-secondary text-sm font-label">
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {notice && (
        <div className="pib-card border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-green-400">
          {notice}
        </div>
      )}

      {/* Pause switch */}
      <div
        className={`pib-card p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
          data?.controls.pauseOutbound ? 'border border-red-500/40 bg-red-500/5' : ''
        }`}
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-on-surface-variant">
              {data?.controls.pauseOutbound ? 'pause_circle' : 'play_circle'}
            </span>
            <h2 className="text-lg font-headline font-bold text-on-surface">Outbound email</h2>
            {data?.controls.pauseOutbound ? (
              <span className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">
                Paused
              </span>
            ) : (
              <span
                className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full"
                style={{ background: 'var(--color-accent-v2)20', color: 'var(--color-accent-v2)' }}
              >
                Sending
              </span>
            )}
          </div>
          <p className="text-sm text-on-surface-variant mt-1 max-w-xl">
            Global kill-switch. When paused, broadcasts and test sends are blocked and queued for the
            worker to dispatch once resumed.
          </p>
        </div>
        <button
          onClick={togglePause}
          disabled={savingPause || loading}
          className={data?.controls.pauseOutbound ? 'pib-btn-primary text-sm font-label' : 'pib-btn-secondary text-sm font-label'}
        >
          {savingPause ? 'Working…' : data?.controls.pauseOutbound ? 'Resume sending' : 'Pause outbound'}
        </button>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {loading ? (
          <>
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </>
        ) : (
          <>
            <div className="pib-card p-4">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                Sent ({data?.windowDays}d)
              </p>
              <p className="text-2xl font-headline font-bold text-on-surface mt-1">{m?.sent ?? 0}</p>
            </div>
            <div className="pib-card p-4">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                Delivered
              </p>
              <p className="text-2xl font-headline font-bold text-on-surface mt-1">{m?.delivered ?? 0}</p>
            </div>
            <div className={`pib-card p-4 ${bounceWarn ? 'border border-red-500/30' : ''}`}>
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                Bounce rate
              </p>
              <p className={`text-2xl font-headline font-bold mt-1 ${bounceWarn ? 'text-red-400' : 'text-on-surface'}`}>
                {m?.bounceRatePct ?? 0}%
              </p>
              <p className="text-[11px] text-on-surface-variant mt-0.5">{m?.bounced ?? 0} bounced · keep &lt; 4%</p>
            </div>
            <div className={`pib-card p-4 ${complaintWarn ? 'border border-red-500/30' : ''}`}>
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                Complaint rate
              </p>
              <p className={`text-2xl font-headline font-bold mt-1 ${complaintWarn ? 'text-red-400' : 'text-on-surface'}`}>
                {m?.complaintRatePct ?? 0}%
              </p>
              <p className="text-[11px] text-on-surface-variant mt-0.5">{m?.complained ?? 0} complaints · keep &lt; 0.3%</p>
            </div>
          </>
        )}
      </div>

      {/* Domain auth status */}
      <div className="pib-card p-5">
        <h2 className="text-lg font-headline font-bold text-on-surface mb-3">Sending domains</h2>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
          </div>
        ) : !data || data.domains.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No sending domains configured yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-label uppercase tracking-widest text-on-surface-variant border-b border-[var(--color-card-border)]">
                  <th className="py-2 pr-3">Domain</th>
                  <th className="py-2 pr-3">Org</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">SPF</th>
                  <th className="py-2 pr-3">DKIM</th>
                  <th className="py-2 pr-3">DMARC</th>
                  <th className="py-2 pr-3">Synced</th>
                </tr>
              </thead>
              <tbody>
                {data.domains.map((d) => (
                  <tr key={d.id} className="border-b border-[var(--color-card-border)]/50">
                    <td className="py-2 pr-3 font-mono text-on-surface">{d.name}</td>
                    <td className="py-2 pr-3 text-on-surface-variant text-xs">{d.orgId || '—'}</td>
                    <td className="py-2 pr-3 text-on-surface-variant text-xs">{d.status}</td>
                    <td className="py-2 pr-3"><AuthBadge state={d.spf} /></td>
                    <td className="py-2 pr-3"><AuthBadge state={d.dkim} /></td>
                    <td className="py-2 pr-3"><AuthBadge state={d.dmarc} /></td>
                    <td className="py-2 pr-3 text-on-surface-variant text-xs">{fmtTime(d.lastSyncedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent events */}
      <div className="pib-card p-5">
        <h2 className="text-lg font-headline font-bold text-on-surface mb-3">Recent email events</h2>
        {loading ? (
          <Skeleton className="h-32 rounded-lg" />
        ) : !data || data.events.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No recent events in the window.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-label uppercase tracking-widest text-on-surface-variant border-b border-[var(--color-card-border)]">
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Event</th>
                  <th className="py-2 pr-3">To</th>
                  <th className="py-2 pr-3">Subject</th>
                  <th className="py-2 pr-3">Org</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((ev) => (
                  <tr key={ev.emailId} className="border-b border-[var(--color-card-border)]/50">
                    <td className="py-2 pr-3 text-on-surface-variant text-xs whitespace-nowrap">{fmtTime(ev.at)}</td>
                    <td className={`py-2 pr-3 font-label text-xs ${EVENT_CLS[ev.event] ?? 'text-on-surface'}`}>
                      {ev.event}
                    </td>
                    <td className="py-2 pr-3 text-on-surface text-xs">{ev.to || '—'}</td>
                    <td className="py-2 pr-3 text-on-surface-variant text-xs max-w-[240px] truncate">{ev.subject || '—'}</td>
                    <td className="py-2 pr-3 text-on-surface-variant text-xs">{ev.orgId || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Suppression removal */}
      <div className="pib-card p-5">
        <h2 className="text-lg font-headline font-bold text-on-surface">Remove a suppression</h2>
        <p className="text-sm text-on-surface-variant mt-0.5 mb-3 max-w-2xl">
          Clear an address from an org&apos;s suppression list (e.g. a recovered hard bounce). This also
          resets the soft-bounce counter.
        </p>
        <form onSubmit={removeSuppression} className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <label className="block flex-1">
            <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">Org ID</span>
            <input
              type="text"
              value={supOrg}
              onChange={(e) => setSupOrg(e.target.value)}
              placeholder="org_xxx"
              className="pib-input w-full mt-1 font-mono"
              required
            />
          </label>
          <label className="block flex-1">
            <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">Email</span>
            <input
              type="email"
              value={supEmail}
              onChange={(e) => setSupEmail(e.target.value)}
              placeholder="person@example.com"
              className="pib-input w-full mt-1"
              required
            />
          </label>
          <button type="submit" disabled={removing} className="pib-btn-secondary text-sm font-label">
            {removing ? 'Removing…' : 'Remove'}
          </button>
        </form>
      </div>

      <HeaderInspector />
    </div>
  )
}
