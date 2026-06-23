'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  DeliverabilityReport,
  DomainAuthStatus,
  AuthStatus,
  DeliverabilityAlert,
} from '@/lib/email-analytics/deliverability'

interface DeliverabilityWorkspaceProps {
  orgId?: string
  orgSlug?: string
  orgName?: string
}

function scopedUrl(path: string, orgId?: string) {
  const search = new URLSearchParams()
  const clean = orgId?.trim()
  if (clean) search.set('orgId', clean)
  const q = search.toString()
  return q ? `${path}?${q}` : path
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`
}

const AUTH_PILL: Record<AuthStatus, string> = {
  pass: 'pib-pill pib-pill-success',
  fail: 'pib-pill pib-pill-danger',
  missing: 'pib-pill pib-pill-warn',
  unknown: 'pib-pill',
}

const AUTH_LABEL: Record<AuthStatus, string> = {
  pass: 'Pass',
  fail: 'Fail',
  missing: 'Missing',
  unknown: 'Unknown',
}

function AuthBadge({ status, label }: { status: AuthStatus; label: string }) {
  return (
    <span className={`${AUTH_PILL[status]} !text-[10px]`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {label}: {AUTH_LABEL[status]}
    </span>
  )
}

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--color-pib-accent)'
  if (score >= 60) return '#FBBF24'
  return '#F87171'
}

function ReputationGauge({ score }: { score: number }) {
  // Half-circle gauge: 180° sweep from -90° to +90°.
  const radius = 80
  const circumference = Math.PI * radius
  const filled = (score / 100) * circumference
  const color = scoreColor(score)
  return (
    <div className="relative flex flex-col items-center">
      <svg width="200" height="120" viewBox="0 0 200 120" aria-hidden="true">
        <path
          d="M 20 110 A 80 80 0 0 1 180 110"
          fill="none"
          stroke="var(--color-pib-line)"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <path
          d="M 20 110 A 80 80 0 0 1 180 110"
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
        />
      </svg>
      <div className="absolute top-12 flex flex-col items-center">
        <span className="font-display text-4xl" style={{ color }}>
          {score}
        </span>
        <span className="eyebrow !text-[10px]">Reputation</span>
      </div>
    </div>
  )
}

function MetricTile({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="bento-card !p-4">
      <p className="eyebrow !text-[10px]">{label}</p>
      <p className={`font-display text-2xl mt-1 ${danger ? 'text-[#F87171]' : ''}`}>{value}</p>
    </div>
  )
}

function AlertBanner({ alert }: { alert: DeliverabilityAlert }) {
  const critical = alert.level === 'critical'
  return (
    <div
      className={`rounded-lg border p-3 flex gap-3 items-start ${
        critical ? 'border-red-400/30 bg-red-500/10' : 'border-amber-400/30 bg-amber-500/10'
      }`}
    >
      <span
        className={`material-symbols-outlined text-[18px] ${critical ? 'text-red-200' : 'text-amber-200'}`}
        aria-hidden="true"
      >
        {critical ? 'error' : 'warning'}
      </span>
      <p className={`text-sm ${critical ? 'text-red-50' : 'text-amber-50'}`}>{alert.message}</p>
    </div>
  )
}

function DomainAuthCard({ domain }: { domain: DomainAuthStatus }) {
  return (
    <div className="bento-card !p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-[var(--color-pib-text-muted)] text-[18px]">dns</span>
          <p className="font-medium truncate">{domain.domain}</p>
          {domain.verified ? (
            <span className="pib-pill pib-pill-success !text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              Verified
            </span>
          ) : (
            <span className="pib-pill pib-pill-warn !text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              Unverified
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <AuthBadge status={domain.spf} label="SPF" />
          <AuthBadge status={domain.dkim} label="DKIM" />
          <AuthBadge status={domain.dmarc} label="DMARC" />
        </div>
      </div>
    </div>
  )
}

export function DeliverabilityWorkspace({ orgId, orgName }: DeliverabilityWorkspaceProps) {
  const scopedOrgId = orgId?.trim() || undefined
  const endpoint = scopedUrl('/api/v1/email/deliverability', scopedOrgId)
  const tenantHeaders = useMemo<Record<string, string> | undefined>(
    () => (scopedOrgId ? { 'X-Org-Id': scopedOrgId } : undefined),
    [scopedOrgId],
  )

  const [report, setReport] = useState<DeliverabilityReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(endpoint, tenantHeaders ? { headers: tenantHeaders } : undefined)
      .then((r) => r.json())
      .then((body) => {
        if (body?.success === false) {
          setError(body.error ?? 'Failed to load deliverability')
          return
        }
        setReport((body.data ?? body) as DeliverabilityReport)
      })
      .catch(() => setError('Failed to load deliverability'))
      .finally(() => setLoading(false))
  }, [endpoint, tenantHeaders])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-10">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow">{orgName || 'Email health'}</p>
          <h1 className="pib-page-title mt-2">Deliverability</h1>
          <p className="pib-page-sub max-w-2xl">
            Sender reputation, bounce and complaint rates, blacklist status, and per-domain
            authentication over the last 30 days.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="btn-pib-secondary disabled:opacity-50" type="button">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error && (
        <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-50">{error}</div>
      )}

      {loading && !report ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="pib-skeleton h-24" />
          ))}
        </div>
      ) : report ? (
        <>
          {report.alerts.length > 0 && (
            <section className="space-y-2">
              {report.alerts.map((a, i) => (
                <AlertBanner key={`${a.code}-${i}`} alert={a} />
              ))}
            </section>
          )}

          <section className="grid gap-4 lg:grid-cols-[260px_1fr] items-center">
            <div className="bento-card !p-6 flex justify-center">
              <ReputationGauge score={report.reputationScore} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricTile label="Sent (30d)" value={report.sent30d.toLocaleString()} />
              <MetricTile label="Delivery rate" value={pct(report.deliveryRate30d)} />
              <MetricTile
                label="Bounce rate"
                value={pct(report.bounceRate30d)}
                danger={report.bounceRate30d > 0.05}
              />
              <MetricTile
                label="Complaint rate"
                value={pct(report.spamComplaintRate30d)}
                danger={report.spamComplaintRate30d > 0.001}
              />
            </div>
          </section>

          <section>
            <h2 className="font-display text-xl mb-3">Blacklist status</h2>
            <div className="bento-card !p-5">
              <div className="flex items-center gap-3 flex-wrap">
                {report.blacklist.clean ? (
                  <span className="pib-pill pib-pill-success">
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    Not listed
                  </span>
                ) : (
                  <span className="pib-pill pib-pill-danger">
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    Listed on {report.blacklist.listings.length} blocklist
                    {report.blacklist.listings.length === 1 ? '' : 's'}
                  </span>
                )}
                <span className="text-xs text-[var(--color-pib-text-muted)]">
                  Method: {report.blacklist.method === 'dns' ? 'live DNSBL lookup' : 'internal signal estimate'}
                </span>
              </div>
              {report.blacklist.note && (
                <p className="text-xs text-[var(--color-pib-text-muted)] mt-2">{report.blacklist.note}</p>
              )}
              {report.blacklist.checkedZones.length > 0 && (
                <p className="text-xs text-[var(--color-pib-text-muted)] mt-2 font-mono">
                  Zones: {report.blacklist.checkedZones.join(', ')}
                </p>
              )}
              {report.blacklist.listings.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {report.blacklist.listings.map((l, i) => (
                    <li key={`${l.ip}-${l.zone}-${i}`} className="text-sm font-mono text-[#F87171]">
                      {l.ip} → {l.zone}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section>
            <h2 className="font-display text-xl mb-3">Domain authentication</h2>
            {report.domains.length === 0 ? (
              <div className="bento-card !p-6 text-sm text-[var(--color-pib-text-muted)]">
                No sending domains configured. Verify a domain to send signed mail.
              </div>
            ) : (
              <div className="space-y-3">
                {report.domains.map((d) => (
                  <DomainAuthCard key={d.domainId} domain={d} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="font-display text-xl mb-3">Recommendations</h2>
            <div className="bento-card !p-5">
              <ul className="space-y-2">
                {report.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="material-symbols-outlined text-[var(--color-pib-accent)] text-[18px]">
                      check_circle
                    </span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
