'use client'

// components/email/SpamScoreCheck.tsx
//
// Spam-score checker UI (US-140). Calls
//   POST /api/v1/email/campaigns/[id]/spam-check
// and renders a 0–10 score gauge (higher = spammier) plus the list of
// triggered rules with per-rule weights.
//
// Designed to drop into a campaign review step (US-105 imports it):
//   import { SpamScoreCheck } from '@/components/email/SpamScoreCheck'
//   <SpamScoreCheck campaignId={id} />
//
// If the review step has live (possibly-unsaved) editor content, pass it via
// `liveContent` — it goes to the API as the { html, subject, text } body
// fallback so the score reflects exactly what's on screen.

import { useCallback, useEffect, useState } from 'react'

export type SpamVerdict = 'clean' | 'low-risk' | 'spammy' | 'high-risk'

export interface SpamRuleResult {
  id: string
  label: string
  points: number
  hit: boolean
  detail?: string
}

export interface SpamScoreData {
  score: number
  verdict: SpamVerdict
  rules: SpamRuleResult[]
  source?: string
  scannedAt?: string
}

export interface SpamScoreCheckProps {
  campaignId: string
  /** Bearer token for API auth (agent / session). Omit to rely on cookie auth. */
  authToken?: string
  /** Live editor content sent as the analysis fallback (overrides stored content). */
  liveContent?: { html: string; subject: string; text?: string }
  /** Run a check automatically on mount. Default false. */
  autoRun?: boolean
  /** Fired after every successful check. */
  onResult?: (data: SpamScoreData) => void
  className?: string
}

const VERDICT_META: Record<SpamVerdict, { label: string; color: string; ring: string }> = {
  clean: { label: 'Clean', color: 'text-emerald-500', ring: 'stroke-emerald-500' },
  'low-risk': { label: 'Low risk', color: 'text-lime-500', ring: 'stroke-lime-500' },
  spammy: { label: 'Spammy', color: 'text-amber-500', ring: 'stroke-amber-500' },
  'high-risk': { label: 'High risk', color: 'text-red-500', ring: 'stroke-red-500' },
}

function unwrap<T>(body: T | { data?: T }): T | { data?: T } {
  if (body && typeof body === 'object' && 'data' in body) return body.data ?? body
  return body
}

function Gauge({ score, verdict }: { score: number; verdict: SpamVerdict }) {
  const meta = VERDICT_META[verdict]
  const pct = Math.max(0, Math.min(1, score / 10))
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const dash = circumference * pct
  return (
    <div className="relative flex h-32 w-32 items-center justify-center">
      <svg viewBox="0 0 120 120" className="h-32 w-32 -rotate-90">
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="10"
          className="stroke-surface-container-high"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className={meta.ring}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={`text-3xl font-bold ${meta.color}`}>{score.toFixed(1)}</span>
        <span className="text-[10px] uppercase tracking-wide text-on-surface-variant">/ 10</span>
      </div>
    </div>
  )
}

export function SpamScoreCheck({
  campaignId,
  authToken,
  liveContent,
  autoRun = false,
  onResult,
  className = '',
}: SpamScoreCheckProps) {
  const [data, setData] = useState<SpamScoreData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runCheck = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`
      const res = await fetch(`/api/v1/email/campaigns/${campaignId}/spam-check`, {
        method: 'POST',
        headers,
        body: JSON.stringify(liveContent ?? {}),
      })
      const json = await res.json()
      if (!res.ok || json?.success === false) {
        throw new Error(json?.error || `Spam check failed (${res.status})`)
      }
      const result = unwrap(json) as SpamScoreData
      setData(result)
      onResult?.(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Spam check failed')
    } finally {
      setLoading(false)
    }
  }, [campaignId, authToken, liveContent, onResult])

  useEffect(() => {
    if (autoRun) void runCheck()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun])

  const triggered = (data?.rules ?? [])
    .filter((r) => r.hit)
    .sort((a, b) => b.points - a.points)
  const goodSignals = triggered.filter((r) => r.points < 0)
  const penalties = triggered.filter((r) => r.points >= 0)

  return (
    <div className={`pib-card ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-on-surface">Spam score</h3>
          <p className="mt-0.5 text-xs text-on-surface-variant">
            Rule-based, SpamAssassin-style analysis. Higher = more likely to hit spam.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runCheck()}
          disabled={loading}
          className="shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-on-primary disabled:opacity-50"
        >
          {loading ? 'Checking…' : data ? 'Re-check' : 'Run check'}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {!data && !error && !loading && (
        <div className="mt-6 py-8 text-center text-xs text-on-surface-variant">
          Run a check to score this campaign&apos;s spam likelihood.
        </div>
      )}

      {data && (
        <div className="mt-4">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-6">
            <Gauge score={data.score} verdict={data.verdict} />
            <div className="min-w-0 flex-1">
              <div className={`text-lg font-semibold ${VERDICT_META[data.verdict].color}`}>
                {VERDICT_META[data.verdict].label}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                {penalties.length === 0
                  ? 'No spam triggers fired. This email reads as legitimate.'
                  : `${penalties.length} rule${penalties.length === 1 ? '' : 's'} added to the score${
                      goodSignals.length ? `, ${goodSignals.length} good signal pulled it down` : ''
                    }.`}
              </p>
              {data.source && (
                <p className="mt-1 text-[11px] text-on-surface-variant">
                  Analysed: {data.source.replace('-', ' ')}
                </p>
              )}
            </div>
          </div>

          {triggered.length > 0 && (
            <ul className="mt-5 divide-y divide-outline-variant border-t border-outline-variant">
              {triggered.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <span className="text-sm text-on-surface">{r.label}</span>
                    {r.detail && (
                      <p className="mt-0.5 text-xs leading-relaxed text-on-surface-variant">
                        {r.detail}
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                      r.points < 0
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-amber-500/10 text-amber-400'
                    }`}
                  >
                    {r.points > 0 ? '+' : ''}
                    {r.points.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default SpamScoreCheck
