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
    <div className="space-y-8 max-w-3xl mx-auto">
      <header>
        <Link href="/admin/settings" className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">← Settings</Link>
        <p className="eyebrow mt-2">Admin · Infrastructure</p>
        <h1 className="pib-page-title mt-2">Admin Alerts</h1>
      </header>

      {feedback && <div className="st-panel py-2 text-xs text-[var(--color-pib-green)]">{feedback}</div>}
      {error && <div className="st-panel py-2 text-xs text-[var(--color-error)]">{error}</div>}

      {/* Webhook */}
      <div className="st-panel space-y-3">
        <p className="sc-tiny">Webhook</p>
        <label className="block">
          <span className="text-xs text-[var(--color-pib-text-muted)]">Webhook URL (Slack incoming webhook or any JSON endpoint)</span>
          <input
            value={config.webhookUrl}
            onChange={(e) => setConfig((c) => ({ ...c, webhookUrl: e.target.value }))}
            placeholder="https://hooks.slack.com/services/..."
            className="st-input mt-1 font-mono"
          />
        </label>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--color-pib-text)]">Slack formatting enabled</span>
          <SettingsSwitch
            checked={config.slackEnabled}
            label="Slack formatting"
            onChange={() => setConfig((c) => ({ ...c, slackEnabled: !c.slackEnabled }))}
          />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={save} disabled={saving || loading} className="st-btn st-btn--primary disabled:opacity-60">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={sendTest} disabled={testing || !config.webhookUrl} className="st-btn st-btn--secondary disabled:opacity-60">
            {testing ? 'Sending…' : 'Send test'}
          </button>
        </div>
      </div>

      {/* Event matrix */}
      <div className="st-panel">
        <p className="sc-tiny mb-3">Event subscriptions</p>
        <div className="overflow-hidden rounded-[6px] border border-[var(--color-pib-line)]">
          {events.map((evt) => (
            <div key={evt} className="flex items-center justify-between border-b border-[var(--color-pib-line)] px-4 py-3 last:border-b-0">
              <div>
                <p className="text-sm text-[var(--color-pib-text)]">{EVENT_LABELS[evt] ?? evt}</p>
                <code className="text-[11px] text-[var(--color-pib-text-muted)] font-mono">{evt}</code>
              </div>
              <SettingsSwitch checked={!!config.events[evt]} label={`Alert on ${evt}`} onChange={() => toggleEvent(evt)} />
            </div>
          ))}
        </div>
      </div>

      {/* History */}
      <div className="st-panel">
        <p className="sc-tiny mb-3">Delivery history (50 most recent)</p>
        {history.length === 0 ? (
          <p className="text-sm text-[var(--color-pib-text-muted)]">No alerts dispatched yet.</p>
        ) : (
          <div className="overflow-hidden rounded-[6px] border border-[var(--color-pib-line)]">
            <div className="grid grid-cols-12 gap-2 border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] px-3 py-2 sc-tiny">
              <span className="col-span-4">Event</span>
              <span className="col-span-2">Status</span>
              <span className="col-span-3">HTTP / error</span>
              <span className="col-span-3 text-right">When</span>
            </div>
            {history.map((h) => (
              <div key={h.id} className="grid grid-cols-12 gap-2 border-b border-[var(--color-pib-line)] px-3 py-2 text-xs last:border-b-0">
                <span className="col-span-4 font-mono text-[var(--color-pib-text-muted)] truncate">{h.event}</span>
                <span className={`col-span-2 ${h.status === 'sent' ? 'text-green-400' : 'text-red-300'}`}>{h.status}</span>
                <span className="col-span-3 text-[var(--color-pib-text-muted)] truncate">{h.error ? h.error : h.httpStatus ?? '-'}</span>
                <span className="col-span-3 text-right text-[var(--color-pib-text-muted)]">{h.at ? new Date(h.at).toLocaleString() : '-'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
