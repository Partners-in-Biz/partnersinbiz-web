'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

type GscProperty = {
  siteUrl: string
  permissionLevel?: string
}

const AUTOPILOT_MODES = [
  {
    value: 'off',
    label: 'Off',
    detail: 'Pip drafts only. You approve every task before execution.',
    icon: 'edit_note',
  },
  {
    value: 'safe',
    label: 'Safe',
    detail: 'Default mode. Pip runs low-risk drafts and queues publishing work.',
    icon: 'shield',
  },
  {
    value: 'full',
    label: 'Full',
    detail: 'Pip can publish blog posts and repurpose approved content.',
    icon: 'rocket_launch',
  },
] as const

export default function SettingsTab() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const id = params.id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sprint, setSprint] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [gscProperties, setGscProperties] = useState<GscProperty[]>([])
  const [gscLoading, setGscLoading] = useState(false)
  const [gscError, setGscError] = useState<string | null>(null)
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

  useEffect(() => {
    if (!sprint?.integrations?.gsc?.connected) return
    void (async () => {
      setGscLoading(true)
      setGscError(null)
      try {
        const res = await fetch(`/api/v1/seo/integrations/gsc/properties/${id}`)
        const json = await res.json().catch(() => null)
        if (res.ok && json?.success) {
          setGscProperties(Array.isArray(json.data) ? json.data : [])
        } else {
          setGscProperties([])
          setGscError(json?.error ?? `Could not load GSC properties (${res.status})`)
        }
      } catch (err) {
        setGscProperties([])
        setGscError(err instanceof Error ? err.message : 'Could not load GSC properties')
      } finally {
        setGscLoading(false)
      }
    })()
  }, [id, sprint?.integrations?.gsc?.connected])

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

  async function selectGscProperty(propertyUrl: string) {
    if (!propertyUrl) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/v1/seo/integrations/gsc/connect/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ propertyUrl }),
      })
      const json = await res.json().catch(() => null)
      if (res.ok && json?.success) {
        setMessage('GSC property selected')
        setSprint({
          ...sprint,
          integrations: {
            ...sprint.integrations,
            gsc: {
              ...sprint.integrations?.gsc,
              propertyUrl,
            },
          },
        })
      } else {
        setMessage(json?.error ?? `Could not select GSC property (${res.status})`)
      }
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <div className="pib-card max-w-3xl border-red-500/40 bg-red-500/10 text-sm text-red-100">
        <div className="flex items-center gap-2 font-semibold text-red-50">
          <span className="material-symbols-outlined text-base">error</span>
          Could not load sprint settings
        </div>
        <p className="mt-2 text-red-100/80">{loadError}</p>
      </div>
    )
  }

  if (!sprint) {
    return (
      <div className="max-w-5xl space-y-4">
        <div className="pib-skeleton h-20 w-full" />
        <div className="pib-skeleton h-48 w-full" />
        <div className="pib-skeleton h-56 w-full" />
      </div>
    )
  }

  const gscConnected = !!sprint.integrations?.gsc?.connected
  const gscPropertyUrl = sprint.integrations?.gsc?.propertyUrl ?? ''
  const pagespeedEnabled = !!sprint.integrations?.pagespeed?.enabled

  return (
    <div className="max-w-5xl space-y-5">
      {justConnectedGsc && (
        <div className="pib-card border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-200">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base">check_circle</span>
            <span>Google Search Console connected. Select the matching property below.</span>
          </div>
        </div>
      )}

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="pib-label mb-2">Sprint controls</p>
          <h2 className="text-2xl font-semibold text-[var(--color-pib-text)]">Settings</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
            Manage automation boundaries and data connections for this SEO sprint.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={gscConnected ? 'pib-pill pib-pill-success' : 'pib-pill pib-pill-warn'}>
            <span className="material-symbols-outlined text-sm">{gscConnected ? 'link' : 'link_off'}</span>
            GSC {gscConnected ? 'connected' : 'not connected'}
          </span>
          <span className={pagespeedEnabled ? 'pib-pill pib-pill-info' : 'pib-pill'}>
            <span className="material-symbols-outlined text-sm">speed</span>
            PageSpeed {pagespeedEnabled ? 'on' : 'off'}
          </span>
        </div>
      </header>

      <section className="pib-card-section">
        <div className="pib-card-section-header flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Autopilot mode</h3>
            <p className="text-xs text-[var(--color-pib-text-muted)]">Choose how much execution Pip can do without review.</p>
          </div>
          {saving && <span className="pib-pill">Saving</span>}
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-3">
          {AUTOPILOT_MODES.map((mode) => {
            const selected = sprint.autopilotMode === mode.value
            return (
              <button
                key={mode.value}
                type="button"
                onClick={() => update({ autopilotMode: mode.value })}
                disabled={saving}
                aria-pressed={selected}
                className={[
                  'min-h-[132px] rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60',
                  selected
                    ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent-soft)]'
                    : 'border-[var(--color-pib-line)] bg-white/[0.02] hover:border-[var(--color-pib-line-strong)] hover:bg-white/[0.04]',
                ].join(' ')}
              >
                <span
                  className={[
                    'mb-3 grid h-9 w-9 place-items-center rounded-xl border',
                    selected
                      ? 'border-[rgba(245,166,35,0.45)] bg-[rgba(245,166,35,0.16)] text-[var(--color-pib-accent-hover)]'
                      : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)]',
                  ].join(' ')}
                >
                  <span className="material-symbols-outlined text-[20px]">{mode.icon}</span>
                </span>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--color-pib-text)]">{mode.label}</span>
                  {selected && <span className="pib-pill pib-pill-accent !px-2 !py-0.5">Active</span>}
                </div>
                <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">{mode.detail}</p>
              </button>
            )
          })}
        </div>
      </section>

      <section className="pib-card-section">
        <div className="pib-card-section-header">
          <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Integrations</h3>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Connect the data sources this sprint uses for audits and execution.</p>
        </div>

        <div className="pib-card-section-row flex-col items-stretch gap-4 lg:flex-row lg:items-start">
          <div className="flex min-w-0 gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--color-pib-line)] bg-white/[0.03] text-[var(--color-pib-text-muted)]">
              <span className="material-symbols-outlined text-[20px]">search</span>
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-[var(--color-pib-text)]">Google Search Console</h4>
                <span className={gscConnected ? 'pib-pill pib-pill-success' : 'pib-pill pib-pill-warn'}>
                  {gscConnected ? 'Connected' : 'Not connected'}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                {gscPropertyUrl || 'Connect and choose the verified domain property for this client.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={connectGsc}
            className="pib-btn-secondary shrink-0 justify-center text-xs font-label"
          >
            <span className="material-symbols-outlined text-base">sync</span>
            {sprint.integrations?.gsc?.connected ? 'Reconnect' : 'Connect'}
          </button>
        </div>

        {sprint.integrations?.gsc?.connected && (
          <div className="border-b border-[var(--color-pib-line)] px-4 pb-4 sm:px-5">
            <div className="rounded-2xl border border-[var(--color-pib-line)] bg-black/10 p-4">
              <label className="pib-label" htmlFor="gsc-property">
                Search Console property
              </label>
              <select
                id="gsc-property"
                value={gscPropertyUrl}
                onChange={(e) => selectGscProperty(e.target.value)}
                disabled={saving || gscLoading || gscProperties.length === 0}
                className="pib-select"
              >
                <option value="">{gscLoading ? 'Loading properties...' : 'Select property'}</option>
                {gscProperties.map((property) => (
                  <option key={property.siteUrl} value={property.siteUrl}>
                    {property.siteUrl}
                    {property.permissionLevel ? ` - ${property.permissionLevel}` : ''}
                  </option>
                ))}
              </select>
              {gscError && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-red-300">
                  <span className="material-symbols-outlined text-sm">error</span>
                  {gscError}
                </p>
              )}
              {!gscError && gscPropertyUrl && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-green-300">
                  <span className="material-symbols-outlined text-sm">verified</span>
                  This sprint is mapped to {gscPropertyUrl}.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="pib-card-section-row flex-col items-stretch gap-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--color-pib-line)] bg-white/[0.03] text-[var(--color-pib-text-muted)]">
              <span className="material-symbols-outlined text-[20px]">speed</span>
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-[var(--color-pib-text)]">PageSpeed Insights</h4>
                <span className={pagespeedEnabled ? 'pib-pill pib-pill-info' : 'pib-pill'}>{pagespeedEnabled ? 'Enabled' : 'Disabled'}</span>
              </div>
              <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Use Core Web Vitals and lab checks during sprint health passes.</p>
            </div>
          </div>
          <label className="inline-flex cursor-pointer items-center justify-between gap-3 rounded-full border border-[var(--color-pib-line)] bg-white/[0.02] px-3 py-2 text-xs text-[var(--color-pib-text-muted)] transition hover:border-[var(--color-pib-line-strong)] sm:justify-start">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={pagespeedEnabled}
              onChange={(e) =>
                update({
                  integrations: { ...sprint.integrations, pagespeed: { enabled: e.target.checked } },
                })
              }
              disabled={saving}
            />
            <span
              className={[
                'relative h-5 w-9 rounded-full transition',
                pagespeedEnabled ? 'bg-[var(--color-pib-accent)]' : 'bg-white/10',
              ].join(' ')}
            >
              <span
                className={[
                  'absolute top-0.5 h-4 w-4 rounded-full transition',
                  pagespeedEnabled ? 'left-4 bg-black' : 'left-0.5 bg-[var(--color-pib-text)]',
                ].join(' ')}
              />
            </span>
            <span>{pagespeedEnabled ? 'On' : 'Off'}</span>
          </label>
        </div>
      </section>

      <section className="pib-card-section border-red-500/25">
        <div className="pib-card-section-row flex-col items-stretch gap-4 sm:flex-row sm:items-center">
          <div className="flex gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-red-500/25 bg-red-500/10 text-red-300">
              <span className="material-symbols-outlined text-[20px]">archive</span>
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Archive sprint</h3>
              <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Hide this sprint from active SEO operations.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              if (!confirm('Archive this sprint?')) return
              await fetch(`/api/v1/seo/sprints/${id}/archive`, { method: 'POST' })
              window.location.href = '/portal/seo'
            }}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-red-500/35 px-4 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-500/10"
          >
            <span className="material-symbols-outlined text-base">archive</span>
            Archive sprint
          </button>
        </div>
      </section>

      {message && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-4 py-3 text-sm text-[var(--color-pib-text)] shadow-2xl">
          {message}
        </div>
      )}
    </div>
  )
}
