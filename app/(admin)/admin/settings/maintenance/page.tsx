// app/(admin)/admin/settings/maintenance/page.tsx
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { SettingsSwitch } from '@/components/admin/governance/SettingsSwitch'

interface HistoryEntry {
  id: string
  enabled: boolean
  message?: string
  window?: { start: string | null; end: string | null }
  ipAllowlist?: string[]
  actor?: { uid?: string; role?: string }
  at?: string
}

interface MaintenanceState {
  enabled: boolean
  message: string
  scheduledStart: string | null
  scheduledEnd: string | null
  ipAllowlist: string[]
  history: HistoryEntry[]
}

// Convert ISO -> value for <input type="datetime-local"> (local time, no tz).
function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localInputToIso(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export default function MaintenancePage() {
  const [enabled, setEnabled] = useState(false)
  const [message, setMessage] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [ips, setIps] = useState<string[]>([])
  const [newIp, setNewIp] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/settings/maintenance')
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Load failed')
      const data: MaintenanceState = body.data ?? body
      setEnabled(data.enabled)
      setMessage(data.message || '')
      setStart(isoToLocalInput(data.scheduledStart))
      setEnd(isoToLocalInput(data.scheduledEnd))
      setIps(Array.isArray(data.ipAllowlist) ? data.ipAllowlist : [])
      setHistory(Array.isArray(data.history) ? data.history : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load maintenance settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function addIp() {
    const ip = newIp.trim()
    if (!ip) return
    if (!ips.includes(ip)) setIps((cur) => [...cur, ip])
    setNewIp('')
  }

  function removeIp(ip: string) {
    setIps((cur) => cur.filter((x) => x !== ip))
  }

  async function save(nextEnabled?: boolean) {
    setSaving(true)
    setFeedback(null)
    setError(null)
    const payload = {
      enabled: typeof nextEnabled === 'boolean' ? nextEnabled : enabled,
      message,
      scheduledStart: localInputToIso(start),
      scheduledEnd: localInputToIso(end),
      ipAllowlist: ips,
    }
    try {
      const res = await fetch('/api/v1/admin/settings/maintenance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Save failed')
      if (typeof nextEnabled === 'boolean') setEnabled(nextEnabled)
      setFeedback('Maintenance settings saved.')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <Link href="/admin/settings" className="text-xs text-on-surface-variant hover:text-on-surface">← Settings</Link>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1 mt-2">Infrastructure</p>
        <h1 className="text-2xl font-headline font-bold text-on-surface">Maintenance Mode</h1>
      </div>

      {feedback && (
        <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-400">{feedback}</div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
      )}

      {/* Master toggle */}
      <div className="pib-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-on-surface">Maintenance mode</p>
            <p className="text-xs text-on-surface-variant mt-0.5">
              {enabled ? 'Platform is in maintenance now.' : 'Platform is live. Toggle to take it offline immediately.'}
            </p>
          </div>
          <SettingsSwitch
            checked={enabled}
            disabled={loading || saving}
            label="Toggle maintenance mode"
            onChange={() => save(!enabled)}
          />
        </div>
      </div>

      {/* Schedule + message */}
      <div className="pib-card space-y-4">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Scheduled window</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-on-surface-variant">Start</span>
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-on-surface"
            />
          </label>
          <label className="block">
            <span className="text-xs text-on-surface-variant">End</span>
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-on-surface"
            />
          </label>
        </div>
        <label className="block">
          <span className="text-xs text-on-surface-variant">Message shown to visitors</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="We'll be back shortly — performing scheduled maintenance."
            className="mt-1 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-on-surface"
          />
        </label>
      </div>

      {/* IP allowlist */}
      <div className="pib-card space-y-3">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">IP allowlist (bypass maintenance)</p>
        <div className="flex gap-2">
          <input
            value={newIp}
            onChange={(e) => setNewIp(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addIp() } }}
            placeholder="e.g. 203.0.113.5"
            className="flex-1 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-on-surface"
          />
          <button
            type="button"
            onClick={addIp}
            className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm text-on-surface hover:bg-[var(--color-row-hover)]"
          >
            Add
          </button>
        </div>
        {ips.length === 0 ? (
          <p className="text-xs text-on-surface-variant">No allowlisted IPs. All traffic is blocked during maintenance.</p>
        ) : (
          <div className="space-y-1">
            {ips.map((ip) => (
              <div key={ip} className="flex items-center justify-between rounded-lg border border-[var(--color-card-border)] px-3 py-2">
                <code className="font-mono text-xs text-on-surface">{ip}</code>
                <button type="button" onClick={() => removeIp(ip)} className="text-xs text-red-300 hover:text-red-200">Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => save()}
          disabled={saving || loading}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: 'var(--color-accent-v2)' }}
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      {/* History */}
      <div className="pib-card">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-3">Change history (50 most recent)</p>
        {history.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No changes recorded yet.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--color-card-border)]">
            <div className="grid grid-cols-12 gap-2 border-b border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
              <span className="col-span-2">State</span>
              <span className="col-span-4">Window</span>
              <span className="col-span-4">Actor</span>
              <span className="col-span-2 text-right">When</span>
            </div>
            {history.map((h) => (
              <div key={h.id} className="grid grid-cols-12 gap-2 border-b border-[var(--color-card-border)] px-3 py-2 text-xs last:border-b-0">
                <span className={`col-span-2 ${h.enabled ? 'text-amber-400' : 'text-on-surface-variant'}`}>{h.enabled ? 'ON' : 'OFF'}</span>
                <span className="col-span-4 text-on-surface-variant truncate">
                  {h.window?.start ? new Date(h.window.start).toLocaleString() : '—'}
                  {h.window?.end ? ` → ${new Date(h.window.end).toLocaleString()}` : ''}
                </span>
                <span className="col-span-4 text-on-surface-variant truncate">{h.actor?.uid || '—'}</span>
                <span className="col-span-2 text-right text-on-surface-variant">{h.at ? new Date(h.at).toLocaleString() : '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
