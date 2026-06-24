'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Surface, StatusPill, DialogDrawer, EmptyState } from '@/components/ui/AppFoundation'
import { apiGet, apiSend, formatDateTime } from '@/components/admin/orgs/OrgDetailApi'

interface ProfileLink {
  orgId: string
  orgName: string
  profile: string
  baseUrl: string
  dashboardBaseUrl: string | null
  host: string
  port: number | null
  enabled: boolean
  capabilities: Record<string, boolean>
  permissions: Record<string, unknown>
  hasApiKey: boolean
  hasDashboardSessionToken: boolean
  lastHeartbeat: string | null
  requestsToday: number
  updatedAt: unknown
  updatedBy: string | null
}

interface OrgRef {
  id: string
  name: string
}

interface Summary {
  total: number
  enabled: number
  disabled: number
  pausedAll: boolean
  requestsToday: number
}

interface ControlPlaneData {
  links: ProfileLink[]
  orgs: OrgRef[]
  summary: Summary
}

interface RunRow {
  id: string
  profile: string | null
  status: string
  prompt: string | null
  model: string | null
  requestedBy: string | null
  createdAt: string | null
}

function heartbeatTone(iso: string | null): 'success' | 'warn' | 'danger' | 'neutral' {
  if (!iso) return 'neutral'
  const age = Date.now() - new Date(iso).getTime()
  if (age < 1000 * 60 * 60) return 'success'
  if (age < 1000 * 60 * 60 * 24) return 'warn'
  return 'danger'
}

export function HermesControlPlane() {
  const [data, setData] = useState<ControlPlaneData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await apiGet<ControlPlaneData>('/api/v1/admin/hermes/control-plane')
      setData(d)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Hermes control plane')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // ── Global pause / resume ───────────────────────────────────────────────
  const [pauseBusy, setPauseBusy] = useState(false)
  async function pauseAll(action: 'pause' | 'resume') {
    setPauseBusy(true)
    setActionError('')
    try {
      await apiSend('/api/v1/admin/hermes/pause-all', 'POST', { action })
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : `Failed to ${action}`)
    } finally {
      setPauseBusy(false)
    }
  }

  // ── Per-card restart ────────────────────────────────────────────────────
  const [restartBusy, setRestartBusy] = useState<string | null>(null)
  const [restartResult, setRestartResult] = useState<{ orgName: string; detail: string; health: string } | null>(null)
  async function restart(link: ProfileLink) {
    setRestartBusy(link.orgId)
    setActionError('')
    try {
      const r = await apiSend<{ detail: string; health: string }>(
        `/api/v1/admin/hermes/profiles/${encodeURIComponent(link.orgId)}/restart`,
        'POST',
        {},
      )
      setRestartResult({ orgName: link.orgName, detail: r.detail, health: r.health })
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Restart failed')
    } finally {
      setRestartBusy(null)
    }
  }

  // ── Logs drawer ─────────────────────────────────────────────────────────
  const [logsFor, setLogsFor] = useState<ProfileLink | null>(null)
  const [logs, setLogs] = useState<RunRow[] | null>(null)
  const [logsError, setLogsError] = useState('')
  async function openLogs(link: ProfileLink) {
    setLogsFor(link)
    setLogs(null)
    setLogsError('')
    try {
      const r = await apiGet<{ runs: RunRow[] }>(`/api/v1/admin/hermes/profiles/${encodeURIComponent(link.orgId)}/logs?limit=40`)
      setLogs(r.runs)
    } catch (e) {
      setLogsError(e instanceof Error ? e.message : 'Failed to load logs')
    }
  }

  // ── SOUL drawer ─────────────────────────────────────────────────────────
  const [soulFor, setSoulFor] = useState<ProfileLink | null>(null)
  const [soulText, setSoulText] = useState('')
  const [soulLoading, setSoulLoading] = useState(false)
  const [soulSaving, setSoulSaving] = useState(false)
  const [soulError, setSoulError] = useState('')

  function extractSoul(payload: unknown): string {
    if (typeof payload === 'string') return payload
    if (payload && typeof payload === 'object') {
      const o = payload as Record<string, unknown>
      if (typeof o.soul === 'string') return o.soul
      if (o.soul && typeof o.soul === 'object') {
        const inner = o.soul as Record<string, unknown>
        if (typeof inner.soul === 'string') return inner.soul
        if (typeof inner.content === 'string') return inner.content
      }
      if (typeof o.content === 'string') return o.content
    }
    return JSON.stringify(payload, null, 2)
  }

  async function openSoul(link: ProfileLink) {
    setSoulFor(link)
    setSoulText('')
    setSoulError('')
    setSoulLoading(true)
    try {
      const r = await apiGet<{ soul: unknown }>(`/api/v1/admin/hermes/profiles/${encodeURIComponent(link.orgId)}/soul`)
      setSoulText(extractSoul(r.soul))
    } catch (e) {
      setSoulError(e instanceof Error ? e.message : 'Failed to read SOUL')
    } finally {
      setSoulLoading(false)
    }
  }

  async function saveSoul() {
    if (!soulFor) return
    setSoulSaving(true)
    setSoulError('')
    try {
      await apiSend(`/api/v1/admin/hermes/profiles/${encodeURIComponent(soulFor.orgId)}/soul`, 'PUT', { soul: soulText })
      setSoulFor(null)
    } catch (e) {
      setSoulError(e instanceof Error ? e.message : 'Failed to save SOUL')
    } finally {
      setSoulSaving(false)
    }
  }

  // ── Routing-table editor ────────────────────────────────────────────────
  const [routeOpen, setRouteOpen] = useState(false)
  const [routeOrg, setRouteOrg] = useState('')
  const [routeProfile, setRouteProfile] = useState('')
  const [routeBaseUrl, setRouteBaseUrl] = useState('')
  const [routeDashboardUrl, setRouteDashboardUrl] = useState('')
  const [routeApiKey, setRouteApiKey] = useState('')
  const [routeEnabled, setRouteEnabled] = useState(true)
  const [routeSaving, setRouteSaving] = useState(false)
  const [routeError, setRouteError] = useState('')

  function openRouteCreate() {
    setRouteOrg('')
    setRouteProfile('')
    setRouteBaseUrl('')
    setRouteDashboardUrl('')
    setRouteApiKey('')
    setRouteEnabled(true)
    setRouteError('')
    setRouteOpen(true)
  }

  function openRouteEdit(link: ProfileLink) {
    setRouteOrg(link.orgId)
    setRouteProfile(link.profile)
    setRouteBaseUrl(link.baseUrl)
    setRouteDashboardUrl(link.dashboardBaseUrl ?? '')
    setRouteApiKey('')
    setRouteEnabled(link.enabled)
    setRouteError('')
    setRouteOpen(true)
  }

  async function saveRoute() {
    if (!routeOrg || !routeProfile.trim() || !routeBaseUrl.trim()) {
      setRouteError('Org, profile, and base URL are required')
      return
    }
    setRouteSaving(true)
    setRouteError('')
    try {
      await apiSend(`/api/v1/admin/hermes/profiles/${encodeURIComponent(routeOrg)}`, 'PUT', {
        profile: routeProfile.trim(),
        baseUrl: routeBaseUrl.trim(),
        ...(routeDashboardUrl.trim() ? { dashboardBaseUrl: routeDashboardUrl.trim() } : {}),
        ...(routeApiKey.trim() ? { apiKey: routeApiKey.trim() } : {}),
        enabled: routeEnabled,
      })
      setRouteOpen(false)
      await load()
    } catch (e) {
      setRouteError(e instanceof Error ? e.message : 'Failed to save routing entry')
    } finally {
      setRouteSaving(false)
    }
  }

  async function toggleEnabled(link: ProfileLink) {
    setActionError('')
    try {
      await apiSend(`/api/v1/admin/hermes/profiles/${encodeURIComponent(link.orgId)}`, 'PUT', {
        profile: link.profile,
        baseUrl: link.baseUrl,
        ...(link.dashboardBaseUrl ? { dashboardBaseUrl: link.dashboardBaseUrl } : {}),
        enabled: !link.enabled,
      })
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to toggle')
    }
  }

  const summary = data?.summary
  const links = useMemo(() => data?.links ?? [], [data])

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="pib-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Admin operations</p>
            <h1 className="pib-page-title mt-2">Hermes control plane</h1>
            <p className="mt-3 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
              Manage the org→agent routing table, restart agents, view run logs, edit SOULs, and pause the whole
              fleet. Per-agent performance lives in <a className="underline" href="/admin/hermes/metrics">Hermes metrics</a>.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="pib-btn-primary" onClick={openRouteCreate}>Add routing entry</button>
            {summary?.pausedAll ? (
              <button type="button" className="pib-btn-secondary" disabled={pauseBusy} onClick={() => pauseAll('resume')}>
                {pauseBusy ? 'Working…' : 'Resume all'}
              </button>
            ) : (
              <button
                type="button"
                className="pib-btn-secondary"
                style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.4)' }}
                disabled={pauseBusy}
                onClick={() => pauseAll('pause')}
              >
                {pauseBusy ? 'Working…' : 'Pause all agents'}
              </button>
            )}
          </div>
        </div>
      </header>

      {error && <div className="pib-card border border-red-500/30 bg-red-500/5 p-5 text-sm text-red-400">{error}</div>}
      {actionError && <div className="pib-card border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-300">{actionError}</div>}

      {loading ? (
        <div className="pib-card p-8 text-sm text-[var(--color-pib-text-muted)]">Loading control plane…</div>
      ) : (
        <>
          {summary && (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {[
                { label: 'Profile links', value: summary.total },
                { label: 'Enabled', value: summary.enabled },
                { label: 'Disabled', value: summary.disabled },
                { label: 'Requests today', value: summary.requestsToday },
                { label: 'Fleet state', value: summary.pausedAll ? 'Paused' : 'Active' },
              ].map((m) => (
                <div key={m.label} className="pib-card p-5">
                  <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{m.label}</p>
                  <p className="mt-3 text-2xl font-semibold text-on-surface">{m.value}</p>
                </div>
              ))}
            </section>
          )}

          {links.length === 0 ? (
            <EmptyState
              icon="hub"
              title="No routing entries"
              description="Add an org→agent routing entry to wire a client organisation to a Hermes profile."
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {links.map((link) => (
                <Surface
                  key={link.orgId}
                  header={
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="font-label">{link.orgName}</span>
                      <div className="flex items-center gap-2">
                        <StatusPill tone="info">{link.profile}</StatusPill>
                        <StatusPill tone={link.enabled ? 'success' : 'warn'}>{link.enabled ? 'Enabled' : 'Disabled'}</StatusPill>
                      </div>
                    </div>
                  }
                >
                  <dl className="space-y-1.5 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-on-surface-variant">VPS host</dt><dd className="text-on-surface"><code>{link.host}</code></dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-on-surface-variant">Port</dt><dd className="text-on-surface"><code>{link.port ?? '—'}</code></dd></div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-on-surface-variant">Last heartbeat</dt>
                      <dd><StatusPill tone={heartbeatTone(link.lastHeartbeat)}>{link.lastHeartbeat ? formatDateTime(link.lastHeartbeat) : 'No activity'}</StatusPill></dd>
                    </div>
                    <div className="flex justify-between gap-3"><dt className="text-on-surface-variant">Requests today</dt><dd className="text-on-surface">{link.requestsToday}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-on-surface-variant">API key</dt><dd className="text-on-surface">{link.hasApiKey ? 'Set' : 'Missing'}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-on-surface-variant">Dashboard token</dt><dd className="text-on-surface">{link.hasDashboardSessionToken ? 'Set' : '—'}</dd></div>
                  </dl>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" className="pib-btn-secondary text-xs" disabled={restartBusy === link.orgId} onClick={() => void restart(link)}>
                      {restartBusy === link.orgId ? 'Restarting…' : 'Restart'}
                    </button>
                    <button type="button" className="pib-btn-ghost text-xs" onClick={() => void openLogs(link)}>View logs</button>
                    <button type="button" className="pib-btn-ghost text-xs" onClick={() => void openSoul(link)}>Edit SOUL</button>
                    <button type="button" className="pib-btn-ghost text-xs" onClick={() => openRouteEdit(link)}>Edit routing</button>
                    <button type="button" className="pib-btn-ghost text-xs" onClick={() => void toggleEnabled(link)}>
                      {link.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </Surface>
              ))}
            </div>
          )}
        </>
      )}

      {/* Restart result */}
      <DialogDrawer
        open={restartResult !== null}
        title="Restart requested"
        description=""
        onClose={() => setRestartResult(null)}
        footer={<div className="flex justify-end"><button type="button" className="pib-btn-secondary" onClick={() => setRestartResult(null)}>Close</button></div>}
      >
        {restartResult && (
          <div className="space-y-2 text-sm">
            <p className="text-on-surface">{restartResult.orgName}</p>
            <p className="text-on-surface-variant">{restartResult.detail}</p>
            <div className="flex items-center gap-2"><span className="text-on-surface-variant">Health:</span>
              <StatusPill tone={restartResult.health === 'ok' ? 'success' : restartResult.health === 'degraded' ? 'warn' : 'danger'}>{restartResult.health}</StatusPill>
            </div>
          </div>
        )}
      </DialogDrawer>

      {/* Logs drawer */}
      <DialogDrawer
        open={logsFor !== null}
        title={logsFor ? `${logsFor.orgName} — recent runs` : ''}
        description="Hermes run ledger for this org's profile."
        onClose={() => setLogsFor(null)}
        footer={<div className="flex justify-end"><button type="button" className="pib-btn-secondary" onClick={() => setLogsFor(null)}>Close</button></div>}
      >
        {logsError && <p className="text-sm text-red-400">{logsError}</p>}
        {logs === null && !logsError ? (
          <p className="text-sm text-on-surface-variant">Loading runs…</p>
        ) : logs && logs.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No runs recorded for this org.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {(logs ?? []).map((run) => (
              <li key={run.id} className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <StatusPill tone="neutral">{run.status}</StatusPill>
                  <span className="text-xs text-on-surface-variant">{formatDateTime(run.createdAt)}</span>
                </div>
                {run.prompt && <p className="mt-1 text-xs text-on-surface-variant">{run.prompt}</p>}
                <p className="mt-1 text-[10px] text-on-surface-variant opacity-70">
                  {run.profile ?? '—'}{run.model ? ` · ${run.model}` : ''}{run.requestedBy ? ` · ${run.requestedBy}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DialogDrawer>

      {/* SOUL drawer */}
      <DialogDrawer
        open={soulFor !== null}
        title={soulFor ? `${soulFor.orgName} — SOUL` : ''}
        description="Edit the agent's SOUL/persona. Changes push to the live Hermes profile."
        onClose={() => setSoulFor(null)}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="pib-btn-secondary" onClick={() => setSoulFor(null)}>Cancel</button>
            <button type="button" className="pib-btn-primary" disabled={soulSaving || soulLoading} onClick={saveSoul}>
              {soulSaving ? 'Saving…' : 'Save SOUL'}
            </button>
          </div>
        }
      >
        <div className="space-y-2">
          {soulError && <p className="text-sm text-red-400">{soulError}</p>}
          {soulLoading ? (
            <p className="text-sm text-on-surface-variant">Loading SOUL…</p>
          ) : (
            <textarea
              className="pib-input w-full font-mono text-xs"
              rows={18}
              value={soulText}
              onChange={(e) => setSoulText(e.target.value)}
              placeholder="SOUL.md content…"
            />
          )}
        </div>
      </DialogDrawer>

      {/* Routing-table editor */}
      <DialogDrawer
        open={routeOpen}
        title="Routing entry"
        description="Map an organisation to a Hermes agent profile + endpoint."
        onClose={() => setRouteOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="pib-btn-secondary" onClick={() => setRouteOpen(false)}>Cancel</button>
            <button type="button" className="pib-btn-primary" disabled={routeSaving} onClick={saveRoute}>
              {routeSaving ? 'Saving…' : 'Save routing'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {routeError && <p className="text-sm text-red-400">{routeError}</p>}
          <label className="block">
            <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Organisation</span>
            <select className="pib-input mt-1 w-full" value={routeOrg} onChange={(e) => setRouteOrg(e.target.value)}>
              <option value="">Select org…</option>
              {(data?.orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Profile</span>
            <input className="pib-input mt-1 w-full" placeholder="pip-main" value={routeProfile} onChange={(e) => setRouteProfile(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Base URL</span>
            <input className="pib-input mt-1 w-full" placeholder="https://hermes-vps-01.example:8643" value={routeBaseUrl} onChange={(e) => setRouteBaseUrl(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Dashboard base URL (optional)</span>
            <input className="pib-input mt-1 w-full" placeholder="https://…" value={routeDashboardUrl} onChange={(e) => setRouteDashboardUrl(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">API key {routeOrg && <span className="normal-case opacity-70">(leave blank to keep existing)</span>}</span>
            <input className="pib-input mt-1 w-full" type="password" placeholder="Bearer token" value={routeApiKey} onChange={(e) => setRouteApiKey(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm text-on-surface">
            <input type="checkbox" checked={routeEnabled} onChange={(e) => setRouteEnabled(e.target.checked)} />
            Enabled
          </label>
        </div>
      </DialogDrawer>
    </div>
  )
}

export default HermesControlPlane
