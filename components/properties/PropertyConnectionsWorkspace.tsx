'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'

type Provider =
  | 'adsense'
  | 'admob'
  | 'revenuecat'
  | 'app_store_connect'
  | 'play_console'
  | 'google_ads'
  | 'ga4'
  | 'firebase_analytics'

interface ProviderInfo {
  provider: Provider
  name: string
  description: string
  authKind: 'oauth2' | 'api_key' | 'jwt' | 'service_account'
}

const PROVIDERS: ProviderInfo[] = [
  { provider: 'revenuecat',         name: 'RevenueCat',          description: 'Subscriptions: MRR, ARR, churn, trials, LTV. Real-time webhooks.', authKind: 'api_key' },
  { provider: 'adsense',            name: 'Google AdSense',      description: 'Web ad earnings, impressions, RPM, CTR.',                          authKind: 'oauth2' },
  { provider: 'admob',              name: 'Google AdMob',        description: 'Mobile ad earnings, eCPM, match rate per app.',                    authKind: 'oauth2' },
  { provider: 'app_store_connect',  name: 'App Store Connect',   description: 'iOS downloads, IAP revenue, ratings, refunds.',                    authKind: 'jwt' },
  { provider: 'play_console',       name: 'Google Play Console', description: 'Android installs, ratings, IAP revenue. RTDN webhooks.',           authKind: 'service_account' },
  { provider: 'google_ads',         name: 'Google Ads',          description: 'Campaign spend, conversions, ROAS, CTR.',                          authKind: 'oauth2' },
  { provider: 'ga4',                name: 'Google Analytics 4',  description: 'Sessions, conversions, source/medium attribution.',                 authKind: 'oauth2' },
  { provider: 'firebase_analytics', name: 'Firebase Analytics',  description: 'Mobile engagement and retention via BigQuery export.',              authKind: 'service_account' },
]

interface Connection {
  id: string
  provider: Provider
  propertyId: string
  orgId: string
  authKind: string
  status: 'connected' | 'reauth_required' | 'error' | 'paused' | 'pending'
  hasCredentials: boolean
  lastPulledAt?: { _seconds: number } | null
  lastSuccessAt?: { _seconds: number } | null
  lastError?: string | null
  consecutiveFailures?: number
  backfilledThrough?: string | null
}

function formatTs(ts: { _seconds: number } | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts._seconds * 1000)
  return d.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
}

function StatusPill({ status }: { status: Connection['status'] | 'not_connected' }) {
  const styles: Record<string, string> = {
    connected:        'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    paused:           'bg-amber-500/15 text-amber-300 border-amber-500/30',
    reauth_required:  'bg-amber-500/15 text-amber-300 border-amber-500/30',
    error:            'bg-red-500/15 text-red-300 border-red-500/30',
    pending:          'bg-blue-500/15 text-blue-300 border-blue-500/30',
    not_connected:    'bg-white/5 text-white/60 border-white/10',
  }
  const labels: Record<string, string> = {
    connected:       'Connected',
    paused:          'Paused',
    reauth_required: 'Reauth required',
    error:           'Error',
    pending:         'Pending',
    not_connected:   'Not connected',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-mono uppercase tracking-wider ${styles[status]}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {labels[status]}
    </span>
  )
}

interface PropertyConnectionsWorkspaceProps {
  backHref?: string
}

export function PropertyConnectionsWorkspace({ backHref = '/portal/properties' }: PropertyConnectionsWorkspaceProps) {
  const params = useParams<{ id: string }>()
  const search = useSearchParams()
  const propertyId = params.id

  const [loading, setLoading] = useState(true)
  const [connections, setConnections] = useState<Connection[]>([])
  const [busy, setBusy] = useState<Provider | null>(null)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/v1/properties/${propertyId}/connections`)
      const data = (await r.json()) as { ok: boolean; connections: Connection[] }
      if (data.ok) setConnections(data.connections ?? [])
    } finally {
      setLoading(false)
    }
  }, [propertyId])

  useEffect(() => { load() }, [load])

  // Surface OAuth callback result.
  useEffect(() => {
    const result = search.get('result')
    const provider = search.get('provider')
    const msg = search.get('msg')
    if (result === 'ok' && provider) {
      setFlash({ kind: 'ok', msg: `${provider} connected.` })
    } else if (result === 'error' && provider) {
      setFlash({ kind: 'error', msg: `${provider}: ${msg || 'connection failed.'}` })
    }
  }, [search])

  const byProvider = useMemo(() => {
    const map = new Map<Provider, Connection>()
    for (const c of connections) map.set(c.provider, c)
    return map
  }, [connections])

  async function authorize(p: Provider) {
    setBusy(p)
    try {
      const r = await fetch(`/api/v1/properties/${propertyId}/connections/${p}/authorize`)
      const data = (await r.json()) as { ok?: boolean; authorizeUrl?: string; error?: string }
      if (data.authorizeUrl) {
        window.location.href = data.authorizeUrl
      } else {
        setFlash({ kind: 'error', msg: data.error || 'authorize failed' })
      }
    } finally {
      setBusy(null)
    }
  }

  async function pullNow(p: Provider) {
    setBusy(p)
    try {
      const r = await fetch(`/api/v1/properties/${propertyId}/connections/${p}/pull`, { method: 'POST' })
      const data = await r.json()
      if (data.ok) setFlash({ kind: 'ok', msg: `${p}: ${data.ok || 0} ok / ${data.failed || 0} failed` })
      else setFlash({ kind: 'error', msg: data.error || 'pull failed' })
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function disconnect(p: Provider) {
    if (!confirm(`Disconnect ${p}? Historical metrics are preserved.`)) return
    setBusy(p)
    try {
      const r = await fetch(`/api/v1/properties/${propertyId}/connections/${p}`, { method: 'DELETE' })
      const data = await r.json()
      if (data.ok) setFlash({ kind: 'ok', msg: `${p} disconnected.` })
      else setFlash({ kind: 'error', msg: data.error || 'disconnect failed' })
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-6">
        <div>
          <Link href={`${backHref}/${propertyId}`} className="text-xs uppercase tracking-[0.3em] text-white/40 hover:text-white/70 transition-colors">
            ← Back to property
          </Link>
          <h1 className="mt-2 text-3xl font-display">Connections</h1>
          <p className="mt-1 text-sm text-white/60 max-w-xl">
            Wire this property to ad networks, app stores, and analytics platforms. Daily pulls write into the unified <code className="font-mono text-xs px-1 py-0.5 rounded bg-white/5">metrics</code> fact table.
          </p>
        </div>
      </header>

      {flash && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          flash.kind === 'ok'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
            : 'bg-red-500/10 border-red-500/30 text-red-200'
        }`}>
          {flash.msg}
          <button onClick={() => setFlash(null)} className="float-right text-xs opacity-60 hover:opacity-100">dismiss</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-white/5 h-24" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {PROVIDERS.map((info) => {
            const conn = byProvider.get(info.provider)
            const status = conn?.status ?? 'not_connected'
            const isBusy = busy === info.provider
            return (
              <div key={info.provider} className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-base font-medium text-white">{info.name}</h3>
                      <StatusPill status={status} />
                      <span className="text-[10px] uppercase tracking-wider text-white/30 font-mono">{info.authKind}</span>
                    </div>
                    <p className="text-sm text-white/60">{info.description}</p>
                    {conn && (
                      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <Stat label="Last pulled" value={formatTs(conn.lastPulledAt)} />
                        <Stat label="Last success" value={formatTs(conn.lastSuccessAt)} />
                        <Stat label="Backfilled through" value={conn.backfilledThrough ?? '—'} />
                        <Stat label="Failures" value={String(conn.consecutiveFailures ?? 0)} />
                      </div>
                    )}
                    {conn?.lastError && (
                      <p className="mt-3 text-xs text-red-300 font-mono break-all">{conn.lastError}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!conn && info.authKind === 'oauth2' && (
                      <button
                        disabled={isBusy}
                        onClick={() => authorize(info.provider)}
                        className="px-3 py-1.5 text-xs rounded-full bg-white text-black font-medium hover:bg-[#F5A623] transition-colors disabled:opacity-60"
                      >
                        {isBusy ? 'Connecting…' : 'Connect'}
                      </button>
                    )}
                    {!conn && info.authKind !== 'oauth2' && (
                      <span className="px-3 py-1.5 text-xs rounded-full border border-white/10 text-white/50 font-mono">
                        Add credentials via API
                      </span>
                    )}
                    {conn && (
                      <>
                        <button
                          disabled={isBusy}
                          onClick={() => pullNow(info.provider)}
                          className="px-3 py-1.5 text-xs rounded-full border border-white/15 text-white hover:bg-white/5 transition-colors disabled:opacity-60"
                        >
                          {isBusy ? '…' : 'Pull now'}
                        </button>
                        <button
                          disabled={isBusy}
                          onClick={() => disconnect(info.provider)}
                          className="px-3 py-1.5 text-xs rounded-full border border-red-500/30 text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-60"
                        >
                          Disconnect
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-white/30 font-mono mb-0.5">{label}</p>
      <p className="text-white/80">{value}</p>
    </div>
  )
}
