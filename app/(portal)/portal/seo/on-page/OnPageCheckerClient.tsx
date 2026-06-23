'use client'

import { useState } from 'react'
import { SeoToolHeader, type SprintOption } from '@/components/seo/SeoToolHeader'
import { fetchSeo } from '@/components/seo/seoToolClient'
import type { OnPageCheckResult, OnPageCheckItem } from '@/lib/seo/onpage-check'

type Props = {
  sprints: SprintOption[]
  activeSprintId?: string
  defaultUrl: string
}

function scoreColor(score: number) {
  if (score >= 80) return '#34d399'
  if (score >= 50) return '#fbbf24'
  return '#f87171'
}

function ScoreRing({ score }: { score: number }) {
  const r = 56
  const circ = 2 * Math.PI * r
  const dash = (score / 100) * circ
  const color = scoreColor(score)
  return (
    <svg width="140" height="140" viewBox="0 0 140 140">
      <circle cx="70" cy="70" r={r} fill="none" stroke="var(--color-pib-line)" strokeWidth="10" />
      <circle
        cx="70"
        cy="70"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 70 70)"
      />
      <text
        x="70"
        y="70"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="28"
        fontWeight="700"
        fill="var(--color-pib-text)"
        fontFamily="inherit"
      >
        {score}
      </text>
      <text
        x="70"
        y="92"
        textAnchor="middle"
        fontSize="10"
        fill="var(--color-pib-text-muted)"
        fontFamily="inherit"
      >
        / 100
      </text>
    </svg>
  )
}

function StatusIcon({ status }: { status: 'pass' | 'warn' | 'fail' }) {
  const map: Record<string, { icon: string; color: string }> = {
    pass: { icon: 'check_circle', color: 'text-emerald-400' },
    warn: { icon: 'warning', color: 'text-amber-400' },
    fail: { icon: 'cancel', color: 'text-red-400' },
  }
  const { icon, color } = map[status]
  return (
    <span className={`material-symbols-outlined text-[20px] flex-shrink-0 ${color}`}>{icon}</span>
  )
}

function ChecklistRow({ item }: { item: OnPageCheckItem }) {
  return (
    <div className="flex items-start gap-3 border-b border-[var(--color-pib-line)] last:border-0 px-5 py-3">
      <div className="pt-0.5">
        <StatusIcon status={item.status} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium">{item.label}</p>
          <span className="pib-pill text-[9px]">weight: {item.weight}</span>
        </div>
        <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">{item.detail}</p>
      </div>
    </div>
  )
}

export function OnPageCheckerClient({ sprints, activeSprintId, defaultUrl }: Props) {
  const [url, setUrl] = useState(defaultUrl)
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<OnPageCheckResult | null>(null)

  async function check() {
    if (!url || !keyword) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data = await fetchSeo<OnPageCheckResult>('/api/v1/seo/onpage-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, keyword }),
      })
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check failed')
    } finally {
      setLoading(false)
    }
  }

  const totalWeight = result?.checklist.reduce((s, i) => s + i.weight, 0) ?? 0

  const sortedChecklist = result
    ? [...result.checklist].sort((a, b) => {
        const order = { fail: 0, warn: 1, pass: 2 }
        return order[a.status] - order[b.status]
      })
    : []

  return (
    <div className="space-y-6">
      <SeoToolHeader
        eyebrow="On-page checker"
        title="On-Page Checker"
        description="Check a single URL against your focus keyword for on-page SEO completeness."
        sprints={sprints}
        activeSprintId={activeSprintId}
      />

      <div className="pib-card p-6 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="pib-label">Page URL</label>
            <input
              type="url"
              className="pib-input w-full"
              placeholder="https://example.com/page"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <label className="pib-label">Focus keyword</label>
            <input
              type="text"
              className="pib-input w-full"
              placeholder="e.g. business coaching"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              disabled={loading}
              onKeyDown={(e) => e.key === 'Enter' && check()}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={check}
            disabled={!url || !keyword || loading}
            className="pib-btn-primary text-sm disabled:opacity-50"
          >
            <span
              className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}
            >
              {loading ? 'autorenew' : 'pageview'}
            </span>
            {loading ? 'Checking…' : 'Check page'}
          </button>
          {result && (
            <p className="text-xs text-[var(--color-pib-text-muted)]">Checked {result.url}</p>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span className="material-symbols-outlined text-[16px] align-middle mr-1.5">error</span>
          {error}
        </div>
      )}

      {result && (
        <>
          <div className="pib-card p-8 flex flex-col items-center gap-4">
            <ScoreRing score={result.score} />
            <p className="text-xs text-[var(--color-pib-text-muted)] text-center max-w-xs">
              Overall score based on {result.checklist.length} checks across {totalWeight} weighted
              points.
            </p>
            <div className="flex flex-wrap gap-3 justify-center text-xs">
              <span className="text-emerald-300 font-semibold">
                {result.checklist.filter((i) => i.status === 'pass').length} passed
              </span>
              <span className="text-amber-300 font-semibold">
                {result.checklist.filter((i) => i.status === 'warn').length} warnings
              </span>
              <span className="text-red-300 font-semibold">
                {result.checklist.filter((i) => i.status === 'fail').length} failed
              </span>
            </div>
          </div>

          <div className="pib-card overflow-hidden">
            <div className="pib-card-section-header">
              <h3 className="text-sm font-semibold">Checklist</h3>
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                Issues sorted by severity — fix failures first.
              </p>
            </div>
            <div>
              {sortedChecklist.map((item) => (
                <ChecklistRow key={item.id} item={item} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
