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

// Convert ISO -> value for datetime-local inputs (local time, no tz).
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
    <div className="space-y-8 max-w-3xl mx-auto">
      <header>
        <Link href="/admin/settings" className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">← Settings</Link>
        <p className="eyebrow mt-2">Admin · Infrastructure</p>
        <h1 className="pib-page-title mt-2">Maintenance Mode</h1>
      </header>

      {feedback && (
        <div className="st-panel py-2 text-xs text-[var(--color-pib-green)]">{feedback}</div>
      )}
      {error && (
        <div className="st-panel py-2 text-xs text-[var(--color-error)]">{error}</div>
      )}

      {/* Master toggle */}
      <div className="st-panel">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--color-pib-text)]">Maintenance mode</p>
            <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">
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
      <div className="st-panel space-y-4">
        <p className="sc-tiny">Scheduled window</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-[var(--color-pib-text-muted)]">Start</span>
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="st-input mt-1"
            />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-pib-text-muted)]">End</span>
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="st-input mt-1"
            />
          </label>
        </div>
        <label className="block">
          <span className="text-xs text-[var(--color-pib-text-muted)]">Message shown to visitors</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="We'll be back shortly - performing scheduled maintenance."
            className="st-input mt-1"
          />
        </label>
      </div>

      {/* IP allowlist */}
      <div className="st-panel space-y-3">
        <p className="sc-tiny">IP allowlist (bypass maintenance)</p>
        <div className="flex gap-2">
          <input
            value={newIp}
            onChange={(e) => setNewIp(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addIp() } }}
            placeholder="e.g. 203.0.113.5"
            className="st-input flex-1"
            aria-label="IP address to allowlist"
          />
          <button
            type="button"
            onClick={addIp}
            className="st-btn st-btn--secondary"
          >
            Add
          </button>
        </div>
        {ips.length === 0 ? (
          <p className="text-xs text-[var(--color-pib-text-muted)]">No allowlisted IPs. All traffic is blocked during maintenance.</p>
        ) : (
          <div className="space-y-1">
            {ips.map((ip) => (
              <div key={ip} className="flex items-center justify-between rounded-lg border border-[var(--color-pib-line)] px-3 py-2">
                <code className="font-mono text-xs text-[var(--color-pib-text)]">{ip}</code>
                <button type="button" onClick={() => removeIp(ip)} className="text-xs text-[var(--color-error)] hover:opacity-80">Remove</button>
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
          className="st-btn st-btn--primary disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      {/* History */}
      <div className="st-panel">
        <p className="sc-tiny mb-3">Change history (50 most recent)</p>
        {history.length === 0 ? (
          <p className="text-sm text-[var(--color-pib-text-muted)]">No changes recorded yet.</p>
        ) : (
          <div className="overflow-hidden rounded-[6px] border border-[var(--color-pib-line)]">
            <div className="grid grid-cols-12 gap-2 border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] px-3 py-2 sc-tiny">
              <span className="col-span-2">State</span>
              <span className="col-span-4">Window</span>
              <span className="col-span-4">Actor</span>
              <span className="col-span-2 text-right">When</span>
            </div>
            {history.map((h) => (
              <div key={h.id} className="grid grid-cols-12 gap-2 border-b border-[var(--color-pib-line)] px-3 py-2 text-xs last:border-b-0">
                <span className={`col-span-2 ${h.enabled ? "text-[var(--color-pib-amber)]" : 'text-[var(--color-pib-text-muted)]'}`}>{h.enabled ? 'ON' : 'OFF'}</span>
                <span className="col-span-4 text-[var(--color-pib-text-muted)] truncate">
                  {h.window?.start ? new Date(h.window.start).toLocaleString() : '-'}
                  {h.window?.end ? ` → ${new Date(h.window.end).toLocaleString()}` : ''}
                </span>
                <span className="col-span-4 text-[var(--color-pib-text-muted)] truncate">{h.actor?.uid || '-'}</span>
                <span className="col-span-2 text-right text-[var(--color-pib-text-muted)]">{h.at ? new Date(h.at).toLocaleString() : '-'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
