'use client'

import { useEffect, useState } from 'react'

type SprintRow = {
  id: string
  siteName: string
  siteUrl: string
  gscConnected: boolean
  gscPropertyUrl?: string
}

type GscProperty = { siteUrl: string; permissionLevel?: string }

export function IntegrationsClient({
  sprints,
  justConnectedSprintId,
}: {
  sprints: SprintRow[]
  justConnectedSprintId?: string
}) {
  return (
    <div className="space-y-6">
      <header className="border-b border-[var(--color-pib-line)] pb-5">
        <p className="eyebrow">SEO settings</p>
        <h1 className="mt-2 font-headline text-2xl font-semibold md:text-3xl">Integrations</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
          Connect Google Search Console to pull real ranking, impression and click data into your SEO sprints.
        </p>
      </header>

      {justConnectedSprintId && (
        <div className="pib-card border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-200">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base">check_circle</span>
            <span>Google Search Console connected. Select the matching property below.</span>
          </div>
        </div>
      )}

      {sprints.length === 0 ? (
        <div className="pib-card p-10 text-center text-sm text-[var(--color-pib-text-muted)]">
          No SEO sprints yet. Create a sprint first, then connect Search Console here.
        </div>
      ) : (
        <div className="space-y-4">
          {sprints.map((s) => (
            <GscSprintCard key={s.id} sprint={s} autoLoad={s.id === justConnectedSprintId} />
          ))}
        </div>
      )}
    </div>
  )
}

function GscSprintCard({ sprint, autoLoad }: { sprint: SprintRow; autoLoad: boolean }) {
  const [connected, setConnected] = useState(sprint.gscConnected)
  const [propertyUrl, setPropertyUrl] = useState(sprint.gscPropertyUrl ?? '')
  const [properties, setProperties] = useState<GscProperty[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!connected && !autoLoad) return
    void loadProperties()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, autoLoad])

  async function loadProperties() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/seo/integrations/gsc/properties/${sprint.id}`)
      const json = await res.json().catch(() => null)
      if (res.ok && json?.success) {
        setProperties(Array.isArray(json.data) ? json.data : [])
        setConnected(true)
      } else {
        setError(json?.error ?? `Could not load GSC properties (${res.status})`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load GSC properties')
    } finally {
      setLoading(false)
    }
  }

  async function connect() {
    const res = await fetch(`/api/v1/seo/integrations/gsc/auth-url?sprintId=${sprint.id}`)
    const json = await res.json().catch(() => null)
    if (json?.success && json.data?.url) window.location.href = json.data.url
    else setError(json?.error ?? 'Could not start the Search Console connect flow')
  }

  async function selectProperty(url: string) {
    if (!url) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/v1/seo/integrations/gsc/connect/${sprint.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ propertyUrl: url }),
      })
      const json = await res.json().catch(() => null)
      if (res.ok && json?.success) {
        setPropertyUrl(url)
        setMessage(`Mapped to ${url}`)
      } else {
        setError(json?.error ?? `Could not select property (${res.status})`)
      }
    } finally {
      setSaving(false)
    }
  }

  async function disconnect() {
    if (!confirm(`Disconnect Search Console from ${sprint.siteName}?`)) return
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/seo/integrations/gsc/disconnect/${sprint.id}`, { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (res.ok && json?.success) {
        setConnected(false)
        setProperties([])
        setPropertyUrl('')
        setMessage('Disconnected')
      } else {
        setError(json?.error ?? 'Could not disconnect')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="pib-card-section">
      <div className="pib-card-section-row flex-col items-stretch gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--color-pib-line)] bg-white/[0.03] text-[var(--color-pib-text-muted)]">
            <span className="material-symbols-outlined text-[20px]">search</span>
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-[var(--color-pib-text)]">{sprint.siteName}</h4>
              <span className={connected ? 'pib-pill pib-pill-success' : 'pib-pill pib-pill-warn'}>
                {connected ? 'Connected' : 'Not connected'}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{propertyUrl || sprint.siteUrl || 'Connect and choose the verified property.'}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={connect} className="pib-btn-secondary justify-center text-xs font-label">
            <span className="material-symbols-outlined text-base">sync</span>
            {connected ? 'Reconnect' : 'Connect'}
          </button>
          {connected && (
            <button type="button" onClick={disconnect} disabled={saving} className="inline-flex items-center justify-center gap-1.5 rounded-full border border-red-500/35 px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-500/10 disabled:opacity-40">
              <span className="material-symbols-outlined text-base">link_off</span>
              Disconnect
            </button>
          )}
        </div>
      </div>

      {connected && (
        <div className="px-4 pb-4 sm:px-5">
          <div className="rounded-2xl border border-[var(--color-pib-line)] bg-black/10 p-4">
            <label className="pib-label" htmlFor={`gsc-${sprint.id}`}>Search Console property</label>
            <select
              id={`gsc-${sprint.id}`}
              value={propertyUrl}
              onChange={(e) => selectProperty(e.target.value)}
              disabled={saving || loading || properties.length === 0}
              className="pib-select"
            >
              <option value="">{loading ? 'Loading properties…' : 'Select property'}</option>
              {properties.map((p) => (
                <option key={p.siteUrl} value={p.siteUrl}>
                  {p.siteUrl}{p.permissionLevel ? ` — ${p.permissionLevel}` : ''}
                </option>
              ))}
            </select>
            {error && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-red-300">
                <span className="material-symbols-outlined text-sm">error</span>
                {error}
              </p>
            )}
            {!error && propertyUrl && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-green-300">
                <span className="material-symbols-outlined text-sm">verified</span>
                {message ?? `This sprint is mapped to ${propertyUrl}.`}
              </p>
            )}
          </div>
        </div>
      )}
      {!connected && error && (
        <p className="px-4 pb-4 sm:px-5 flex items-center gap-1.5 text-xs text-red-300">
          <span className="material-symbols-outlined text-sm">error</span>
          {error}
        </p>
      )}
    </section>
  )
}
