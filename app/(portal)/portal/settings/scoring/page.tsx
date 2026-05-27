// app/(portal)/portal/settings/scoring/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
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

  // ── Fetch config ─────────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true)
    setFetchError(null)
    fetch('/api/v1/crm/scoring/config')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((body) => {
        const cfg: ScoringConfig = body.data?.config ?? body.data ?? body
        setConfig(cfg)
        setIcp(cfg.icp ?? {})
        setLeadWeights(cfg.leadWeights ?? {})
        setAiEnabled(cfg.aiEnabled ?? false)
      })
      .catch(() => setFetchError('Failed to load scoring config. Please try again.'))
      .finally(() => setLoading(false))
  }, [])

  // ── Save ──────────────────────────────────────────────────────────────────────

  async function handleSave() {
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
      setSaveMsg('Scoring config saved.')
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Recompute all ─────────────────────────────────────────────────────────────

  async function handleRecompute() {
    if (!confirm('Recompute scores for all contacts? This may take a moment.')) return
    setRecomputing(true)
    setRecomputeMsg(null)
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

  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-semibold mb-1">Lead &amp; ICP Scoring</h1>
      <p className="text-sm text-[var(--color-pib-text-muted)] mb-6">
        Configure how contacts are scored for fit (ICP) and engagement (lead signals).
      </p>

      {loading ? (
        <p className="text-sm text-[var(--color-pib-text-muted)]">Loading…</p>
      ) : fetchError ? (
        <div className="px-4 py-3 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-sm text-[var(--color-pib-text-muted)]">
          {fetchError}
        </div>
      ) : (
        <div className="space-y-6">
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
                <p className="eyebrow !text-[10px] mb-4">ICP Profile</p>
                <IcpProfileEditor value={icp} onChange={setIcp} />
              </>
            )}
            {activeTab === 'weights' && (
              <>
                <p className="eyebrow !text-[10px] mb-4">Lead Signal Weights</p>
                <LeadWeightsEditor value={leadWeights} onChange={setLeadWeights} />
              </>
            )}
          </div>

          {/* AI toggle */}
          <div className="bento-card !p-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">AI scoring</p>
              <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">
                Use AI to compute a supplemental lead score alongside the formula score.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
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

          {/* Actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="cursor-pointer btn-pib-accent flex items-center gap-1.5 text-sm disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[16px]">save</span>
              {saving ? 'Saving…' : 'Save'}
            </button>

            <button
              type="button"
              onClick={handleRecompute}
              disabled={recomputing}
              className="cursor-pointer btn-pib-secondary flex items-center gap-1.5 text-sm disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[16px]">refresh</span>
              {recomputing ? 'Recomputing…' : 'Recompute all'}
            </button>
          </div>

          {/* Recompute feedback */}
          {recomputeMsg && (
            <p className="text-sm text-[var(--color-pib-text-muted)] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">info</span>
              {recomputeMsg}
            </p>
          )}

          {/* Config metadata */}
          {config?.updatedAt && (
            <p className="text-xs text-[var(--color-pib-text-muted)]">
              Last updated: {new Date(config.updatedAt as string).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
