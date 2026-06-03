// app/(portal)/portal/settings/scoring/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { IcpProfileEditor } from '@/components/crm/IcpProfileEditor'
import { LeadWeightsEditor } from '@/components/crm/LeadWeightsEditor'
import { PageTabs } from '@/components/ui/AppFoundation'
import type { IcpProfile, LeadSignalsWeights } from '@/lib/scoring/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScoringConfig {
  orgId: string
  icp: IcpProfile
  leadWeights: LeadSignalsWeights
  aiEnabled: boolean
  aiModel?: string
  aiCacheHours?: number
  updatedAt?: string | number | null
  createdAt?: string | number | null
}

type Tab = 'icp' | 'weights'
const SCORING_TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'icp', label: 'ICP Profile', icon: 'verified_user' },
  { id: 'weights', label: 'Lead Weights', icon: 'bar_chart' },
]

const DEFAULT_WEIGHTS: Required<LeadSignalsWeights> = {
  emailOpens: 2,
  emailClicks: 5,
  emailReplies: 15,
  sequenceCompleted: 10,
  recentContact: 10,
  formSubmission: 8,
}

const LEAD_SIGNAL_LABELS: Record<keyof Required<LeadSignalsWeights>, string> = {
  emailOpens: 'Email opens',
  emailClicks: 'Email clicks',
  emailReplies: 'Email replies',
  sequenceCompleted: 'Sequence completions',
  recentContact: 'Recent contact',
  formSubmission: 'Form submissions',
}

function activeIcpDimensions(icp: IcpProfile): string[] {
  return [
    icp.industries?.length ? 'Industries' : '',
    icp.sizes?.length ? 'Company sizes' : '',
    icp.tiers?.length ? 'Customer tiers' : '',
    icp.regions?.length ? 'Regions' : '',
    icp.minEmployeeCount != null || icp.maxEmployeeCount != null ? 'Employee range' : '',
    icp.minAnnualRevenue != null || icp.maxAnnualRevenue != null ? 'Revenue range' : '',
  ].filter(Boolean)
}

function effectiveWeights(weights: LeadSignalsWeights): Required<LeadSignalsWeights> {
  return {
    emailOpens: weights.emailOpens ?? DEFAULT_WEIGHTS.emailOpens,
    emailClicks: weights.emailClicks ?? DEFAULT_WEIGHTS.emailClicks,
    emailReplies: weights.emailReplies ?? DEFAULT_WEIGHTS.emailReplies,
    sequenceCompleted: weights.sequenceCompleted ?? DEFAULT_WEIGHTS.sequenceCompleted,
    recentContact: weights.recentContact ?? DEFAULT_WEIGHTS.recentContact,
    formSubmission: weights.formSubmission ?? DEFAULT_WEIGHTS.formSubmission,
  }
}

function formatDate(value: unknown): string {
  if (!value) return 'Not saved yet'
  if (typeof value === 'object' && value !== null && 'seconds' in value && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000).toLocaleString()
  }
  const date = new Date(value as string | number)
  return Number.isNaN(date.getTime()) ? 'Not saved yet' : date.toLocaleString()
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: string }) {
  return (
    <div className="pib-stat-card">
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow !text-[10px]">{label}</p>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{icon}</span>
      </div>
      <p className="mt-3 font-display text-3xl leading-none text-[var(--color-pib-text)]">{value}</p>
      <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">{sub}</p>
    </div>
  )
}

function PriorityAction({
  label,
  value,
  copy,
  icon,
  actionLabel,
  onClick,
}: {
  label: string
  value: string
  copy: string
  icon: string
  actionLabel: string
  onClick: () => void
}) {
  return (
    <div className="rounded-xl border border-[var(--color-pib-line)] bg-black/10 p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-[var(--color-pib-text)]">
          <span className="material-symbols-outlined text-[18px]">{icon}</span>
        </span>
        <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-1 text-[10px] text-[var(--color-pib-text-muted)]">
          {value}
        </span>
      </div>
      <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">{label}</h3>
      <p className="mt-2 min-h-[40px] text-xs leading-5 text-[var(--color-pib-text-muted)]">{copy}</p>
      <button
        type="button"
        onClick={onClick}
        className="cursor-pointer btn-pib-secondary mt-4 flex w-full items-center justify-center gap-1.5 text-xs"
      >
        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">arrow_forward</span>
        {actionLabel}
      </button>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ScoringPage() {
  const [config, setConfig] = useState<ScoringConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('icp')

  // Editable slices
  const [icp, setIcp] = useState<IcpProfile>({})
  const [leadWeights, setLeadWeights] = useState<LeadSignalsWeights>({})
  const [aiEnabled, setAiEnabled] = useState(false)

  // Save / recompute state
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [recomputing, setRecomputing] = useState(false)
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null)
  const [recomputeConfirmOpen, setRecomputeConfirmOpen] = useState(false)

  // ── Fetch config ─────────────────────────────────────────────────────────────

  const fetchScoringConfig = useCallback(() => {
    setLoading(true)
    setFetchError(null)
    fetch('/api/v1/crm/scoring/config')
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) {
          throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${r.status}`)
        }
        return body
      })
      .then((body) => {
        const cfg: ScoringConfig = body.data?.config ?? body.data ?? body
        setConfig(cfg)
        setIcp(cfg.icp ?? {})
        setLeadWeights(cfg.leadWeights ?? {})
        setAiEnabled(cfg.aiEnabled ?? false)
      })
      .catch((error: unknown) => {
        setConfig(null)
        setIcp({})
        setLeadWeights({})
        setAiEnabled(false)
        setFetchError(error instanceof Error ? error.message : 'Failed to load scoring config. Please try again.')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchScoringConfig()
  }, [fetchScoringConfig])

  // ── Save ──────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (fetchError) return
    setSaving(true)
    setSaveMsg(null)
    setSaveError(null)
    try {
      const res = await fetch('/api/v1/crm/scoring/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icp, leadWeights, aiEnabled }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Save failed')
      }
      const body = await res.json().catch(() => ({}))
      const nextConfig: ScoringConfig | undefined = body.data?.config ?? body.config
      if (nextConfig) setConfig(nextConfig)
      setSaveMsg('Scoring config saved.')
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Recompute all ─────────────────────────────────────────────────────────────

  async function handleRecompute() {
    if (fetchError) return
    setRecomputeConfirmOpen(true)
  }

  async function confirmRecompute() {
    setRecomputing(true)
    setRecomputeMsg(null)
    setRecomputeConfirmOpen(false)
    try {
      const res = await fetch('/api/v1/crm/scoring/recompute-all', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Recompute failed')
      const { processed = 0, succeeded = 0, failed = 0 } = body.data ?? body
      setRecomputeMsg(`Done — ${processed} processed, ${succeeded} succeeded, ${failed} failed.`)
    } catch (err: unknown) {
      setRecomputeMsg(err instanceof Error ? err.message : 'Recompute failed')
    } finally {
      setRecomputing(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const icpDimensions = activeIcpDimensions(icp)
  const weights = effectiveWeights(leadWeights)
  const explicitWeightCount = Object.keys(DEFAULT_WEIGHTS).filter((key) => leadWeights[key as keyof LeadSignalsWeights] != null).length
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0)
  const strongestSignal = Object.entries(weights).sort((a, b) => b[1] - a[1])[0] ?? ['None', 0]
  const strongestSignalLabel = LEAD_SIGNAL_LABELS[strongestSignal[0] as keyof Required<LeadSignalsWeights>] ?? 'No lead signal weighted'
  const scoringHealth = Math.min(100, Math.round(((Math.min(icpDimensions.length, 4) / 4) * 50) + ((totalWeight > 0 ? 1 : 0) * 30) + (aiEnabled ? 20 : 0)))
  const setupGaps = [
    icpDimensions.length === 0 ? 'Define ICP dimensions' : '',
    totalWeight <= 0 ? 'Add lead weights' : '',
    !aiEnabled ? 'AI score disabled' : '',
  ].filter(Boolean)
  const hasSourceFailure = Boolean(fetchError)

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow">CRM settings</p>
          <h1 className="pib-page-title mt-2">Scoring command center</h1>
          <p className="pib-page-sub max-w-2xl">
            Tune the ICP and lead-signal model that ranks contacts, highlights sales focus, and powers recomputation across the CRM.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading || hasSourceFailure}
            className="cursor-pointer btn-pib-accent flex items-center gap-1.5 text-sm disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">save</span>
            {saving ? 'Saving...' : 'Save model'}
          </button>
          <button
            type="button"
            onClick={handleRecompute}
            disabled={recomputing || loading || hasSourceFailure}
            className="cursor-pointer btn-pib-secondary flex items-center gap-1.5 text-sm disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">refresh</span>
            {recomputing ? 'Recomputing...' : 'Recompute all'}
          </button>
        </div>
      </header>

      {!fetchError && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Scoring health" value={`${scoringHealth}%`} sub={setupGaps.length ? setupGaps.join(', ') : 'Model is ready for contact scoring'} icon="monitoring" />
          <StatCard label="ICP coverage" value={`${icpDimensions.length}/6`} sub={icpDimensions.length ? icpDimensions.join(', ') : 'No fit criteria set yet'} icon="verified_user" />
          <StatCard label="Lead signal weight" value={String(totalWeight)} sub={`${explicitWeightCount}/6 explicitly tuned`} icon="bar_chart" />
          <StatCard label="AI supplement" value={aiEnabled ? 'On' : 'Off'} sub={aiEnabled ? `${config?.aiModel ?? 'Default model'} scoring enabled` : 'Formula scoring only'} icon="auto_awesome" />
        </section>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="pib-skeleton h-24" />)}
        </div>
      ) : fetchError ? (
        <section className="rounded-[var(--radius-card)] border border-amber-500/25 bg-amber-500/[0.07] p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-3">
              <span className="material-symbols-outlined mt-0.5 text-amber-200" aria-hidden="true">warning</span>
              <div>
                <p className="eyebrow !text-[10px] text-amber-200">Source health</p>
                <h2 className="mt-1 font-display text-xl text-[var(--color-pib-text)]">
                  Scoring model could not load
                </h2>
                <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">{fetchError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={fetchScoringConfig}
              className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 text-sm"
              aria-label="Retry loading scoring model"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">refresh</span>
              Retry
            </button>
          </div>
        </section>
      ) : (
        <div className="space-y-8">
          {recomputeConfirmOpen && (
            <section
              role="alertdialog"
              aria-labelledby="recompute-confirm-title"
              aria-describedby="recompute-confirm-description"
              className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-4 py-3 shadow-xl"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex gap-3">
                  <span className="material-symbols-outlined mt-0.5 text-amber-300" aria-hidden="true">
                    warning
                  </span>
                  <div>
                    <p className="eyebrow !text-[10px] text-amber-200">Score recompute confirmation</p>
                    <h2 id="recompute-confirm-title" className="mt-1 font-display text-lg text-[var(--color-pib-text)]">
                      Recompute scores for all contacts?
                    </h2>
                    <p id="recompute-confirm-description" className="mt-2 max-w-3xl text-sm text-amber-100/90">
                      This refreshes lead, ICP, and AI score outputs across the active CRM workspace. Team priority lists may change after it finishes.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRecomputeConfirmOpen(false)}
                    className="btn-pib-secondary text-xs"
                    disabled={recomputing}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmRecompute}
                    className="inline-flex items-center gap-1.5 rounded-md border border-amber-300/30 bg-amber-400/15 px-3 py-2 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-400/25 disabled:opacity-50"
                    disabled={recomputing}
                    aria-label="Confirm recompute all contact scores"
                  >
                    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                      refresh
                    </span>
                    {recomputing ? 'Recomputing...' : 'Recompute scores'}
                  </button>
                </div>
              </div>
            </section>
          )}

          <section className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <div className="bento-card !p-5 space-y-4">
              <div>
                <p className="eyebrow !text-[10px]">Model focus</p>
                <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
                  Keep ICP fit and lead engagement balanced. A strong model should explain both who is a fit and who is showing buying intent.
                </p>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-[var(--color-pib-text-muted)]">ICP fit coverage</span>
                    <span className="font-mono text-[var(--color-pib-text)]">{Math.round((Math.min(icpDimensions.length, 4) / 4) * 100)}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-pib-line-strong)]">
                    <div className="h-full rounded-full bg-[var(--color-pib-accent)]" style={{ width: `${Math.round((Math.min(icpDimensions.length, 4) / 4) * 100)}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-[var(--color-pib-text-muted)]">Lead engagement weight</span>
                    <span className="font-mono text-[var(--color-pib-text)]">{totalWeight} pts</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-pib-line-strong)]">
                    <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.min(100, Math.round((totalWeight / 80) * 100))}%` }} />
                  </div>
                </div>
              </div>
            </div>

            <div className="bento-card !p-5 space-y-4">
              <div>
                <p className="eyebrow !text-[10px]">Operational status</p>
                <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
                  The strongest lead signal is <span className="text-[var(--color-pib-text)]">{strongestSignalLabel}</span> at {strongestSignal[1]} points.
                </p>
              </div>
              <div className="space-y-2 text-xs text-[var(--color-pib-text-muted)]">
                <div className="flex items-center justify-between gap-3">
                  <span>Updated</span>
                  <span className="text-right text-[var(--color-pib-text)]">{formatDate(config?.updatedAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>AI cache</span>
                  <span className="text-[var(--color-pib-text)]">{config?.aiCacheHours ?? 24}h</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Recompute</span>
                  <span className="text-[var(--color-pib-text)]">Admin controlled</span>
                </div>
              </div>
            </div>
          </section>

          {(scoringHealth < 100 || explicitWeightCount < Object.keys(DEFAULT_WEIGHTS).length) && (
            <section className="bento-card !p-0 overflow-hidden">
              <div className="grid gap-0 lg:grid-cols-[minmax(0,0.75fr)_minmax(320px,1.25fr)]">
                <div className="border-b border-[var(--color-pib-line)] p-5 lg:border-b-0 lg:border-r">
                  <p className="eyebrow !text-[10px]">Model setup priorities</p>
                  <h2 className="mt-3 text-xl font-semibold text-[var(--color-pib-text)]">
                    Turn scoring gaps into sales focus
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                    A useful lead score should explain company fit, buying intent, and whether AI is adding judgment. Work these priorities before recomputing scores for the whole team.
                  </p>
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-3">
                  <PriorityAction
                    label="Define ICP fit"
                    value={`${icpDimensions.length}/6 set`}
                    icon="verified_user"
                    copy="Capture industries, tiers, regions, or size bands so sales can tell whether a contact matches the company focus."
                    actionLabel="Review ICP"
                    onClick={() => setActiveTab('icp')}
                  />
                  <PriorityAction
                    label="Tune lead weights"
                    value={`${explicitWeightCount}/6 tuned`}
                    icon="bar_chart"
                    copy="Replace default engagement weights with what your team actually treats as buying intent."
                    actionLabel="Tune lead weights"
                    onClick={() => setActiveTab('weights')}
                  />
                  <PriorityAction
                    label="Enable AI supplement"
                    value={aiEnabled ? 'On' : 'Off'}
                    icon="auto_awesome"
                    copy="Use AI scoring when the team needs a second opinion on fit and urgency beside the formula score."
                    actionLabel={aiEnabled ? 'Review AI scoring' : 'Enable AI scoring'}
                    onClick={() => setAiEnabled(true)}
                  />
                </div>
              </div>
            </section>
          )}

          <PageTabs
            ariaLabel="Scoring settings"
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as Tab)}
            tabs={SCORING_TABS.map((tab) => ({ label: tab.label, value: tab.id, icon: tab.icon }))}
          />

          {/* Tab content */}
          <div className="bento-card !p-6">
            {activeTab === 'icp' && (
              <>
                <div className="mb-5">
                  <p className="eyebrow !text-[10px]">ICP Profile</p>
                  <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
                    Define the companies and regions that should lift a contact&apos;s fit score.
                  </p>
                </div>
                <IcpProfileEditor value={icp} onChange={setIcp} />
              </>
            )}
            {activeTab === 'weights' && (
              <>
                <div className="mb-5">
                  <p className="eyebrow !text-[10px]">Lead Signal Weights</p>
                  <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
                    Tune how engagement signals add urgency to the contact&apos;s lead score.
                  </p>
                </div>
                <LeadWeightsEditor value={leadWeights} onChange={setLeadWeights} />
              </>
            )}
          </div>

          {/* AI toggle */}
          <div className="bento-card !p-5 flex items-center justify-between gap-4">
            <div>
              <p id="ai-scoring-toggle-label" className="text-sm font-medium">AI scoring</p>
              <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">
                Use AI to compute a supplemental lead score alongside the formula score.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                aria-labelledby="ai-scoring-toggle-label"
                className="sr-only peer"
                checked={aiEnabled}
                onChange={(e) => setAiEnabled(e.target.checked)}
              />
              <div className="w-10 h-6 bg-[var(--color-pib-line-strong)] peer-checked:bg-[var(--color-pib-accent)] rounded-full transition-colors" />
              <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
            </label>
          </div>

          {/* Save feedback */}
          {saveMsg && (
            <p className="text-sm text-emerald-400 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">check_circle</span>
              {saveMsg}
            </p>
          )}
          {saveError && (
            <p className="text-sm text-red-400 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">error</span>
              {saveError}
            </p>
          )}

          {/* Recompute feedback */}
          {recomputeMsg && (
            <p className="text-sm text-[var(--color-pib-text-muted)] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">info</span>
              {recomputeMsg}
            </p>
          )}

        </div>
      )}
    </div>
  )
}
