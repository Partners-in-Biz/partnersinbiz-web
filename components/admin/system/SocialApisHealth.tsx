'use client'

import { useCallback, useEffect, useState } from 'react'

type ConnHealth = 'healthy' | 'degraded' | 'down' | 'no_accounts'

interface RateLimitInfo {
  tracked: boolean
  remaining: number | null
  limit: number | null
  resetAt: string | null
}

interface PlatformHealth {
  platform: string
  label: string
  connection: ConnHealth
  totals: { total: number; active: number; tokenExpired: number; disconnected: number; rateLimited: number }
  tokenExpiry: { expiringSoon: number; expired: number; nextExpiryAt: string | null }
  outage: { active: boolean; affected: number; lastError: string | null; lastErrorAt: string | null }
  reAuthRequired: { count: number; accounts: { id: string; orgId: string; displayName: string; status: string }[] }
  rateLimit: RateLimitInfo
}

interface Payload {
  summary: {
    totalAccounts: number
    activeAccounts: number
    platformsConnected: number
    platformsHealthy: number
    platformsDegraded: number
    platformsDown: number
    tokensExpiringSoon: number
    tokensExpired: number
    reAuthRequired: number
    activeOutages: number
  }
  platforms: PlatformHealth[]
  generatedAt: string
}

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return ((body as { data: T }).data) ?? null
  }
  return (body as T) ?? null
}

function relative(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  const diff = ms - Date.now()
  const abs = Math.abs(diff)
  const mins = Math.round(abs / 60000)
  const hrs = Math.round(abs / 3600000)
  const days = Math.round(abs / 86400000)
  const unit = days >= 1 ? `${days}d` : hrs >= 1 ? `${hrs}h` : `${mins}m`
  return diff >= 0 ? `in ${unit}` : `${unit} ago`
}

const CONN_LABEL: Record<ConnHealth, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  down: 'Down',
  no_accounts: 'No accounts',
}

function connPill(connection: ConnHealth): string {
  if (connection === 'healthy') return 'pib-pill pib-pill-success'
  if (connection === 'degraded') return 'pib-pill pib-pill-warn'
  if (connection === 'down') return 'pib-pill pib-pill-danger'
  return 'pib-pill'
}

export function SocialApisHealth() {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true)
    try {
      const res = await fetch('/api/v1/admin/system/social-apis', { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Failed to load social API health')
      setPayload(unwrap<Payload>(body))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load social API health')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  const summary = payload?.summary

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="pib-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">System / Integrations</p>
            <h1 className="pib-page-title mt-2">Social API health</h1>
            <p className="mt-3 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
              Per-platform connection status, token-expiry warnings, outage detection, rate-limit headroom, and
              re-auth prompts across every connected social account on the platform.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="pib-btn-secondary shrink-0 disabled:opacity-60"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {payload?.generatedAt ? (
          <p className="mt-3 text-xs text-on-surface-variant">Snapshot generated {relative(payload.generatedAt)}.</p>
        ) : null}
      </header>

      {loading ? (
        <div className="pib-card p-8 text-sm text-[var(--color-pib-text-muted)]">Loading social API health…</div>
      ) : error ? (
        <div className="pib-card border border-red-500/30 bg-red-500/5 p-5 text-sm text-red-400">{error}</div>
      ) : payload && summary ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Metric label="Platforms connected" value={String(summary.platformsConnected)} helper={`${summary.platformsHealthy} healthy · ${summary.platformsDegraded} degraded · ${summary.platformsDown} down`} />
            <Metric label="Connected accounts" value={String(summary.totalAccounts)} helper={`${summary.activeAccounts} active`} />
            <Metric label="Tokens expiring / expired" value={`${summary.tokensExpiringSoon} / ${summary.tokensExpired}`} helper="Within 7 days · already expired" tone={summary.tokensExpired > 0 ? 'warn' : 'default'} />
            <Metric label="Re-auth required" value={String(summary.reAuthRequired)} helper={`${summary.activeOutages} active outage${summary.activeOutages === 1 ? '' : 's'}`} tone={summary.reAuthRequired > 0 || summary.activeOutages > 0 ? 'warn' : 'default'} />
          </section>

          {summary.activeOutages > 0 ? (
            <div className="pib-card border border-amber-400/30 bg-amber-400/10 p-5">
              <h2 className="text-lg font-semibold text-on-surface">Active outages detected</h2>
              <p className="mt-2 text-sm text-on-surface-variant">
                {summary.activeOutages} platform{summary.activeOutages === 1 ? '' : 's'} reported recent connection errors.
                Review the affected platforms below and trigger re-auth where prompted.
              </p>
            </div>
          ) : null}

          <section className="grid gap-4 lg:grid-cols-2">
            {payload.platforms.map((p) => (
              <div key={p.platform} className="pib-card p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-on-surface">{p.label}</h3>
                  <span className={connPill(p.connection)}>{CONN_LABEL[p.connection]}</span>
                </div>

                {p.totals.total === 0 ? (
                  <p className="text-sm text-on-surface-variant">No accounts connected for this platform.</p>
                ) : (
                  <>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                      <Stat label="Active" value={p.totals.active} />
                      <Stat label="Token expired" value={p.totals.tokenExpired} warn={p.totals.tokenExpired > 0} />
                      <Stat label="Disconnected" value={p.totals.disconnected} warn={p.totals.disconnected > 0} />
                      <Stat label="Rate limited" value={p.totals.rateLimited} warn={p.totals.rateLimited > 0} />
                    </dl>

                    <div className="border-t border-[var(--color-pib-line)] pt-3 text-sm">
                      <Row label="Token expiry">
                        {p.tokenExpiry.expired > 0 || p.tokenExpiry.expiringSoon > 0 ? (
                          <span className="text-amber-400">
                            {p.tokenExpiry.expired} expired · {p.tokenExpiry.expiringSoon} expiring{p.tokenExpiry.nextExpiryAt ? ` · next ${relative(p.tokenExpiry.nextExpiryAt)}` : ''}
                          </span>
                        ) : p.tokenExpiry.nextExpiryAt ? (
                          <span className="text-on-surface-variant">Next {relative(p.tokenExpiry.nextExpiryAt)}</span>
                        ) : (
                          <span className="text-on-surface-variant">No expiry data</span>
                        )}
                      </Row>

                      <Row label="Rate limit">
                        {p.rateLimit.tracked ? (
                          <span className="text-on-surface">
                            {p.rateLimit.remaining ?? '—'}{p.rateLimit.limit != null ? ` / ${p.rateLimit.limit}` : ''} remaining
                            {p.rateLimit.resetAt ? ` · resets ${relative(p.rateLimit.resetAt)}` : ''}
                          </span>
                        ) : (
                          <span className="text-on-surface-variant">Not tracked by provider</span>
                        )}
                      </Row>

                      <Row label="Outage">
                        {p.outage.active ? (
                          <span className="text-red-400">
                            {p.outage.affected} account{p.outage.affected === 1 ? '' : 's'} · {p.outage.lastError ?? 'error'}{p.outage.lastErrorAt ? ` (${relative(p.outage.lastErrorAt)})` : ''}
                          </span>
                        ) : (
                          <span className="text-on-surface-variant">No recent errors</span>
                        )}
                      </Row>
                    </div>

                    {p.reAuthRequired.count > 0 ? (
                      <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3">
                        <p className="text-xs font-label uppercase tracking-widest text-amber-400">
                          Re-auth required ({p.reAuthRequired.count})
                        </p>
                        <ul className="mt-2 space-y-1 text-sm">
                          {p.reAuthRequired.accounts.map((a) => (
                            <li key={a.id} className="flex items-center justify-between gap-3">
                              <span className="truncate text-on-surface">{a.displayName}</span>
                              <span className="shrink-0 text-xs text-on-surface-variant">{a.status} · org {a.orgId || '—'}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ))}
          </section>
        </>
      ) : null}
    </div>
  )
}

function Metric({ label, value, helper, tone = 'default' }: { label: string; value: string; helper?: string; tone?: 'default' | 'warn' }) {
  return (
    <div className={`pib-card p-5 ${tone === 'warn' ? 'border border-amber-400/30 bg-amber-400/5' : ''}`}>
      <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-on-surface">{value}</p>
      {helper ? <p className="mt-2 text-xs text-on-surface-variant">{helper}</p> : null}
    </div>
  )
}

function Stat({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold ${warn && value > 0 ? 'text-amber-400' : 'text-on-surface'}`}>{value}</dd>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-on-surface-variant">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}

export default SocialApisHealth
