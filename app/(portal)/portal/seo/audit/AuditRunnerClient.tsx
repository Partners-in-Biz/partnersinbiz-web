'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { SeoToolHeader, type SprintOption } from '@/components/seo/SeoToolHeader'
import { fetchSeo } from '@/components/seo/seoToolClient'
import type { AuditCategory, AuditIssue, SiteAuditResult } from '@/lib/seo/onpage-audit'
import { Icon } from '@/components/studio'

type AuditDoc = {
  id: string
  snapshotDay?: number
  capturedAt?: string
  onPageScore?: number
  issueBreakdown?: { critical: number; warning: number; info: number }
  issueCategories?: AuditCategory[]
  traffic?: { impressions: number; clicks: number }
}

type Props = {
  sprints: SprintOption[]
  activeSprintId?: string
  activeSiteUrl?: string
  existingAudits: AuditDoc[]
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

function SeverityPill({ severity }: { severity: 'critical' | 'warning' | 'info' }) {
  const map = {
    critical: 'bg-[color-mix(in_srgb,var(--st-danger)_20%,transparent)] text-[var(--st-danger)] border-[color-mix(in_srgb,var(--st-danger)_30%,transparent)]',
    warning: 'bg-[color-mix(in_srgb,var(--st-warning)_20%,transparent)] text-[var(--st-warning)] border-[color-mix(in_srgb,var(--st-warning)_30%,transparent)]',
    info: 'bg-[color-mix(in_srgb,var(--st-info)_20%,transparent)] text-[var(--st-info)] border-[color-mix(in_srgb,var(--st-info)_30%,transparent)]',
  }
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider ${map[severity]}`}
    >
      {severity}
    </span>
  )
}

function BreakdownChips({
  breakdown,
}: {
  breakdown: { critical: number; warning: number; info: number }
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <span className="inline-flex items-center gap-1.5 rounded border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-300">
        <Icon name="error" />
        {breakdown.critical} critical
      </span>
      <span className="inline-flex items-center gap-1.5 rounded border border-amber-500/30 bg-[color-mix(in_srgb,var(--sc-accent)_20%,transparent)] px-3 py-1 text-xs text-[var(--sc-ink-soft)]">
        <Icon name="warning" />
        {breakdown.warning} warnings
      </span>
      <span className="inline-flex items-center gap-1.5 rounded border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs text-blue-300">
        <Icon name="info" />
        {breakdown.info} info
      </span>
    </div>
  )
}

function IssueRow({ issue }: { issue: AuditIssue }) {
  return (
    <div className="border-b border-[var(--color-pib-line)] last:border-0 px-5 py-4 space-y-1">
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          <SeverityPill severity={issue.severity} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{issue.title}</p>
          <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">{issue.howToFix}</p>
          {issue.detail && (
            <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)] opacity-70 font-mono truncate">
              {issue.detail}
            </p>
          )}
          {issue.affectedPages.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {issue.affectedPages.slice(0, 5).map((p) => (
                <span
                  key={p}
                  className="pib-pill pib-pill-success text-[10px] truncate max-w-[220px]"
                  title={p}
                >
                  {p.replace(/^https?:\/\//, '')}
                </span>
              ))}
              {issue.affectedPages.length > 5 && (
                <span className="pib-pill pib-pill-success text-[10px]">+{issue.affectedPages.length - 5} more</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function AuditRunnerClient({
  sprints,
  activeSprintId,
  activeSiteUrl,
  existingAudits,
}: Props) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SiteAuditResult | null>(null)
  const [selectedAudit, setSelectedAudit] = useState<AuditDoc | null>(null)
  const [openCategories, setOpenCategories] = useState<Set<string>>(() => new Set())

  const displayScore = result?.score ?? selectedAudit?.onPageScore
  const displayBreakdown = result?.breakdown ?? selectedAudit?.issueBreakdown
  const displayCategories = result?.categories ?? selectedAudit?.issueCategories

  const toggleCategory = useCallback((cat: string) => {
    setOpenCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }, [])

  async function runAudit() {
    if (!activeSprintId) return
    setRunning(true)
    setError(null)
    setResult(null)
    setSelectedAudit(null)
    try {
      const data = await fetchSeo<SiteAuditResult>('/api/v1/seo/audits/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sprintId: activeSprintId }),
      })
      setResult(data)
      setOpenCategories(new Set(data.categories.map((c) => c.category)))
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Audit failed')
    } finally {
      setRunning(false)
    }
  }

  function selectAudit(audit: AuditDoc) {
    setSelectedAudit(audit)
    setResult(null)
    if (audit.issueCategories) {
      setOpenCategories(new Set(audit.issueCategories.map((c) => c.category)))
    }
  }

  return (
    <div className="space-y-4" data-module-accent="green">
      <SeoToolHeader
        eyebrow="Site audit"
        title="Audit Runner"
        description="Full on-page audit with scored breakdown by category."
        sprints={sprints}
        activeSprintId={activeSprintId}
        action={
          activeSprintId ? (
            <button name="auditrunnerclient-action-36"
              onClick={runAudit}
              disabled={running}
              className="pib-btn-primary text-sm disabled:opacity-50"
            >
              <span className={`inline-flex ${running ? 'animate-spin' : ''}`}>
                <Icon name={running ? 'autorenew' : 'radar'} />
              </span>
              {running ? 'Auditing…' : 'Run new audit'}
            </button>
          ) : null
        }
      />

      {!activeSprintId && (
        <div className="st-panel p-10 text-center">
          <Icon name="health_and_safety" />
          <h3 className="font-headline text-lg mt-3">No active sprint</h3>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-1.5 max-w-md mx-auto">
            Set up an SEO sprint first, then run a full site audit here.
          </p>
        </div>
      )}

      {error && (
        <div className="border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <Icon name="error" />
          {error}
        </div>
      )}

      {running && (
        <div className="st-panel p-10 text-center">
          <Icon name="autorenew" className="animate-spin" />
          <p className="mt-4 text-sm text-[var(--color-pib-text-muted)]">
            Running audit on {activeSiteUrl}…
          </p>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)] opacity-70">
            This can take 30–60 seconds
          </p>
        </div>
      )}

      {!running && displayScore !== undefined && displayBreakdown && (
        <div className="st-panel p-5 flex flex-col items-center gap-5">
          <ScoreRing score={displayScore} />
          <BreakdownChips breakdown={displayBreakdown} />
          {result && (
            <p className="text-xs text-[var(--color-pib-text-muted)]">Audited: {result.url}</p>
          )}
        </div>
      )}

      {!running && displayCategories && displayCategories.length > 0 && (
        <div className="space-y-3">
          {displayCategories.map((cat) => {
            const isOpen = openCategories.has(cat.category)
            const catCritical = cat.issues.filter((i) => i.severity === 'critical').length
            const catWarning = cat.issues.filter((i) => i.severity === 'warning').length
            return (
              <div key={cat.category} className="st-panel overflow-hidden">
                <button name="auditrunnerclient-action-37"
                  onClick={() => toggleCategory(cat.category)}
                  className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-[var(--color-pib-surface-2)] transition-colors"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm">{cat.category}</span>
                    <span className="pib-pill pib-pill-success text-[10px]">{cat.issues.length} issues</span>
                    {catCritical > 0 && (
                      <span className="pib-pill text-[10px] border-red-500/30 bg-red-500/10 text-red-300">
                        {catCritical} critical
                      </span>
                    )}
                    {catWarning > 0 && (
                      <span className="pib-pill text-[10px] border-amber-500/30 bg-[color-mix(in_srgb,var(--sc-accent)_20%,transparent)] text-[var(--sc-ink-soft)]">
                        {catWarning} warnings
                      </span>
                    )}
                  </div>
                  <Icon name={isOpen ? 'expand_less' : 'expand_more'} />
                </button>
                {isOpen && cat.issues.length > 0 && (
                  <div className="border-t border-[var(--color-pib-line)]">
                    {cat.issues.map((issue) => (
                      <IssueRow key={issue.id} issue={issue} />
                    ))}
                  </div>
                )}
                {isOpen && cat.issues.length === 0 && (
                  <div className="border-t border-[var(--color-pib-line)] px-5 py-4 text-sm text-[var(--color-pib-text-muted)]">
                    No issues found in this category.
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {existingAudits.length > 0 && (
        <section className="pib-card-section">
          <div className="pib-card-section-header">
            <h3 className="text-sm">Audit history</h3>
            <p className="text-xs text-[var(--color-pib-text-muted)]">
              Click a past audit to view its breakdown.
            </p>
          </div>
          <div className="divide-y divide-[var(--color-pib-line)]">
            {existingAudits.map((audit) => {
              const isActive = selectedAudit?.id === audit.id
              return (
                <button name="auditrunnerclient-action-38"
                  key={audit.id}
                  onClick={() => selectAudit(audit)}
                  className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm transition-colors hover:bg-[var(--color-pib-surface-2)] ${
 isActive ? 'bg-[var(--color-pib-surface-2)]' : ''
 }`}
                >
                  <div className="space-y-0.5">
                    <p className="font-medium">
                      {audit.capturedAt
                        ? new Date(audit.capturedAt).toLocaleDateString('en-ZA', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : `Day ${audit.snapshotDay ?? '?'}`}
                    </p>
                    {audit.traffic && (
                      <p className="text-xs text-[var(--color-pib-text-muted)]">
                        {audit.traffic.impressions.toLocaleString('en-ZA')} impressions ·{' '}
                        {audit.traffic.clicks.toLocaleString('en-ZA')} clicks
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {audit.onPageScore !== undefined && (
                      <span
                        className="text-2xl tabular-nums"
                        style={{ color: scoreColor(audit.onPageScore) }}
                      >
                        {audit.onPageScore}
                      </span>
                    )}
                    {audit.issueBreakdown && (
                      <div className="flex flex-col gap-0.5 text-right">
                        <span className="text-[10px] text-red-300">
                          {audit.issueBreakdown.critical} critical
                        </span>
                        <span className="text-[10px] text-[var(--sc-ink-soft)]">
                          {audit.issueBreakdown.warning} warn
                        </span>
                      </div>
                    )}
                    {!audit.issueCategories && (
                      <span className="pib-pill text-[10px]">No breakdown</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
