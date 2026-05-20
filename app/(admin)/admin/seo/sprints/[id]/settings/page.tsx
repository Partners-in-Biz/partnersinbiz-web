'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

export default function SettingsTab() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const id = params.id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sprint, setSprint] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const justConnectedGsc = searchParams.get('gsc') === 'connected'

  useEffect(() => {
    void (async () => {
      setLoadError(null)
      try {
        const res = await fetch(`/api/v1/seo/sprints/${id}`)
        const json = await res.json().catch(() => null)
        if (res.ok && json?.success) {
          setSprint(json.data)
        } else {
          setLoadError(json?.error ?? `Failed to load sprint settings (${res.status})`)
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load sprint settings')
      }
    })()
  }, [id])

  async function update(patch: Record<string, unknown>) {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/v1/seo/sprints/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const json = await res.json()
      if (json.success) {
        setMessage('Saved')
        setSprint({ ...sprint, ...patch })
      } else setMessage(json.error)
    } finally {
      setSaving(false)
    }
  }

  async function connectGsc() {
    const res = await fetch(`/api/v1/seo/integrations/gsc/auth-url?sprintId=${id}`)
    const json = await res.json()
    if (json.success) window.location.href = json.data.url
  }

  if (loadError) {
    return (
      <div className="card p-5 max-w-2xl border-red-500/40 bg-red-500/10 text-sm text-red-100">
        <div className="font-semibold text-red-50">Could not load sprint settings</div>
        <p className="mt-2 text-red-100/80">{loadError}</p>
      </div>
    )
  }

  if (!sprint) return <div className="text-sm">Loading…</div>

  return (
    <div className="space-y-6 max-w-2xl">
      {justConnectedGsc && (
        <div className="card p-4 bg-green-50 text-green-900 text-sm">
          GSC connected. Now select your property below.
        </div>
      )}

      <section className="card p-5 space-y-3">
        <h3 className="font-semibold text-sm">Autopilot mode</h3>
        {(['off', 'safe', 'full'] as const).map((mode) => (
          <label key={mode} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="autopilot"
              checked={sprint.autopilotMode === mode}
              onChange={() => update({ autopilotMode: mode })}
              disabled={saving}
            />
            <span className="font-medium capitalize">{mode}</span>
            <span className="text-xs text-[var(--color-pib-text-muted)]">
              {mode === 'off' && '— Pip drafts only, you approve'}
              {mode === 'safe' && '(default) — Pip auto-executes drafts'}
              {mode === 'full' && '— Pip publishes blog posts + repurposes'}
            </span>
          </label>
        ))}
      </section>

      <section className="card p-5 space-y-3">
        <h3 className="font-semibold text-sm">Integrations</h3>
        <div className="flex justify-between items-center text-sm">
          <div>
            <div className="font-medium">Google Search Console</div>
            <div className="text-xs text-[var(--color-pib-text-muted)]">
              {sprint.integrations?.gsc?.connected
                ? `Connected ${sprint.integrations.gsc.propertyUrl ? `(${sprint.integrations.gsc.propertyUrl})` : ''}`
                : 'Not connected'}
            </div>
          </div>
          <button
            onClick={connectGsc}
            className="text-xs px-3 py-1.5 rounded bg-black text-white hover:bg-gray-800"
          >
            {sprint.integrations?.gsc?.connected ? 'Reconnect' : 'Connect'}
          </button>
        </div>
        <div className="flex justify-between items-center text-sm">
          <div>
            <div className="font-medium">PageSpeed Insights</div>
          </div>
          <label className="text-xs">
            <input
              type="checkbox"
              checked={!!sprint.integrations?.pagespeed?.enabled}
              onChange={(e) =>
                update({
                  integrations: { ...sprint.integrations, pagespeed: { enabled: e.target.checked } },
                })
              }
            />{' '}
            Enabled
          </label>
        </div>
      </section>

      <section className="card p-5 space-y-3">
        <h3 className="font-semibold text-sm">Danger zone</h3>
        <button
          onClick={async () => {
            if (!confirm('Archive this sprint?')) return
            await fetch(`/api/v1/seo/sprints/${id}/archive`, { method: 'POST' })
            window.location.href = '/admin/seo'
          }}
          className="text-xs px-3 py-1.5 rounded border border-red-300 text-red-700 hover:bg-red-50"
        >
          Archive sprint
        </button>
      </section>

      {message && <p className="text-sm text-[var(--color-pib-text-muted)]">{message}</p>}
    </div>
  )
}
