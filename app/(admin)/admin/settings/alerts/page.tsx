// app/(admin)/admin/settings/alerts/page.tsx
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { SettingsSwitch } from '@/components/admin/governance/SettingsSwitch'

interface AlertConfig {
  webhookUrl: string
  slackEnabled: boolean
  events: Record<string, boolean>
  availableEvents: string[]
}

interface HistoryEntry {
  id: string
  event: string
  status: string
  httpStatus: number | null
  error?: string
  actor?: { uid?: string }
  at?: string
}

const EVENT_LABELS: Record<string, string> = {
  'org.created': 'Organisation created',
  'billing.payment_failed': 'Billing payment failed',
  'billing.eft_received': 'EFT payment received',
  'support.urgent': 'Urgent support ticket',
  'maintenance.toggled': 'Maintenance toggled',
  'security.admin_lockout': 'Admin lockout (security)',
  'moderation.flagged': 'Content flagged (moderation)',
}

export default function AlertsPage() {
  const [config, setConfig] = useState<AlertConfig>({ webhookUrl: '', slackEnabled: false, events: {}, availableEvents: [] })
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/settings/alerts/history')
      const body = await res.json()
      if (res.ok) setHistory((body.data ?? body) as HistoryEntry[])
    } catch { /* ignore */ }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/settings/alerts')
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Load failed')
      setConfig(body.data ?? body)
      await loadHistory()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load alert config.')
    } finally {
      setLoading(false)
    }
  }, [loadHistory])

  useEffect(() => { load() }, [load])

  function toggleEvent(key: string) {
    setConfig((c) => ({ ...c, events: { ...c.events, [key]: !c.events[key] } }))
  }

  async function save() {
    setSaving(true)
    setFeedback(null)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/settings/alerts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: config.webhookUrl, slackEnabled: config.slackEnabled, events: config.events }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Save failed')
      setConfig(body.data ?? body)
      setFeedback('Alert configuration saved.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  async function sendTest() {
    setTesting(true)
    setFeedback(null)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/settings/alerts/test', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Test failed')
      const data = body.data ?? body
      if (data.status === 'sent') setFeedback(`Test sent (HTTP ${data.httpStatus}).`)
      else setError(`Test failed: ${data.error || `HTTP ${data.httpStatus}`}`)
      await loadHistory()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send test.')
    } finally {
      setTesting(false)
    }
  }

  const events = config.availableEvents?.length ? config.availableEvents : Object.keys(EVENT_LABELS)

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <Link href="/admin/settings" className="text-xs text-on-surface-variant hover:text-on-surface">← Settings</Link>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1 mt-2">Infrastructure</p>
        <h1 className="text-2xl font-headline font-bold text-on-surface">Admin Alerts</h1>
      </div>

      {feedback && <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-400">{feedback}</div>}
      {error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

      {/* Webhook */}
      <div className="pib-card space-y-3">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Webhook</p>
        <label className="block">
          <span className="text-xs text-on-surface-variant">Webhook URL (Slack incoming webhook or any JSON endpoint)</span>
          <input
            value={config.webhookUrl}
            onChange={(e) => setConfig((c) => ({ ...c, webhookUrl: e.target.value }))}
            placeholder="https://hooks.slack.com/services/..."
            className="mt-1 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-on-surface font-mono"
          />
        </label>
        <div className="flex items-center justify-between">
          <span className="text-sm text-on-surface">Slack formatting enabled</span>
          <SettingsSwitch
            checked={config.slackEnabled}
            label="Slack formatting"
            onChange={() => setConfig((c) => ({ ...c, slackEnabled: !c.slackEnabled }))}
          />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={save} disabled={saving || loading} className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60" style={{ background: 'var(--color-accent-v2)' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={sendTest} disabled={testing || !config.webhookUrl} className="rounded-lg border border-[var(--color-card-border)] px-4 py-2 text-sm text-on-surface hover:bg-[var(--color-row-hover)] disabled:opacity-60">
            {testing ? 'Sending…' : 'Send test'}
          </button>
        </div>
      </div>

      {/* Event matrix */}
      <div className="pib-card">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-3">Event subscriptions</p>
        <div className="overflow-hidden rounded-xl border border-[var(--color-card-border)]">
          {events.map((evt) => (
            <div key={evt} className="flex items-center justify-between border-b border-[var(--color-card-border)] px-4 py-3 last:border-b-0">
              <div>
                <p className="text-sm text-on-surface">{EVENT_LABELS[evt] ?? evt}</p>
                <code className="text-[11px] text-on-surface-variant font-mono">{evt}</code>
              </div>
              <SettingsSwitch checked={!!config.events[evt]} label={`Alert on ${evt}`} onChange={() => toggleEvent(evt)} />
            </div>
          ))}
        </div>
      </div>

      {/* History */}
      <div className="pib-card">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-3">Delivery history (50 most recent)</p>
        {history.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No alerts dispatched yet.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--color-card-border)]">
            <div className="grid grid-cols-12 gap-2 border-b border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
              <span className="col-span-4">Event</span>
              <span className="col-span-2">Status</span>
              <span className="col-span-3">HTTP / error</span>
              <span className="col-span-3 text-right">When</span>
            </div>
            {history.map((h) => (
              <div key={h.id} className="grid grid-cols-12 gap-2 border-b border-[var(--color-card-border)] px-3 py-2 text-xs last:border-b-0">
                <span className="col-span-4 font-mono text-on-surface-variant truncate">{h.event}</span>
                <span className={`col-span-2 ${h.status === 'sent' ? 'text-green-400' : 'text-red-300'}`}>{h.status}</span>
                <span className="col-span-3 text-on-surface-variant truncate">{h.error ? h.error : h.httpStatus ?? '—'}</span>
                <span className="col-span-3 text-right text-on-surface-variant">{h.at ? new Date(h.at).toLocaleString() : '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
