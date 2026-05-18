'use client'
// components/ads/TiktokCampaignBuilder.tsx
// 3-step wizard for TikTok campaign creation.
// Step 1 — Campaign (name + objective + budget mode)
// Step 2 — AdGroup (name + budget + optimization + bid + placements + pacing + targeting)
// Step 3 — Ad (identity picker + ad text + CTA + landing URL + creative reference)
// Sub-3c Phase 2 Batch 3B.

import { useState, useEffect } from 'react'
import type { AdObjective } from '@/lib/ads/types'
import { TiktokTargetingEditor } from './TiktokTargetingEditor'
import type { TiktokTargetingValue } from './TiktokTargetingEditor'

// ─── Types ────────────────────────────────────────────────────────────────────

type TkObjective = 'TRAFFIC' | 'LEADS' | 'SALES' | 'AWARENESS' | 'ENGAGEMENT'
type TkBudgetMode = 'BUDGET_MODE_INFINITE' | 'BUDGET_MODE_DAY' | 'BUDGET_MODE_TOTAL'
type TkOptimizationGoal = 'CLICK' | 'CONVERT' | 'REACH' | 'IMPRESSION' | 'VIDEO_VIEW' | 'LEAD_GENERATION'
type TkBidType = 'NO_BID' | 'CUSTOM'
type TkPlacement = 'PLACEMENT_TIKTOK' | 'PLACEMENT_PANGLE' | 'PLACEMENT_TOPBUZZ'
type TkPacing = 'PACING_MODE_SMOOTH' | 'PACING_MODE_FAST'
type TkCTA =
  | 'SHOP_NOW'
  | 'LEARN_MORE'
  | 'SIGN_UP'
  | 'DOWNLOAD'
  | 'CONTACT_US'
  | 'APPLY_NOW'
  | 'BOOK_NOW'
  | 'ORDER_NOW'

interface AdIdentity {
  identityId: string
  identityType: 'AUTH_CODE' | 'CUSTOMIZED_USER' | 'TT_USER'
  displayName?: string
}

interface Step1State {
  campaignName: string
  objective: TkObjective
  budgetMajor: number | ''
  budgetMode: TkBudgetMode
}

interface Step2State {
  adGroupName: string
  dailyBudgetMajor: number
  optimizationGoal: TkOptimizationGoal
  bidType: TkBidType
  bidPriceMajor: number | ''
  placements: TkPlacement[]
  pacing: TkPacing
  targeting: TiktokTargetingValue
}

interface Step3State {
  adName: string
  identityId: string
  identityType: 'AUTH_CODE' | 'CUSTOMIZED_USER' | 'TT_USER' | ''
  adText: string
  callToAction: TkCTA
  landingPageUrl: string
  displayName: string
  imageId: string
}

interface WizardState {
  step1: Step1State
  step2: Step2State
  step3: Step3State
}

interface Props {
  orgId: string
  orgSlug: string
  currency?: string
  initial?: Partial<WizardState>
  onComplete?: (result: { campaignId: string; adSetId: string; adId: string }) => void
  onCancel?: () => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const OBJECTIVES: { value: TkObjective; label: string; description: string; defaultOptGoal: TkOptimizationGoal }[] = [
  { value: 'TRAFFIC', label: 'Traffic', description: 'Drive clicks to your website or app', defaultOptGoal: 'CLICK' },
  { value: 'LEADS', label: 'Leads', description: 'Collect leads via TikTok Instant Form', defaultOptGoal: 'LEAD_GENERATION' },
  { value: 'SALES', label: 'Sales', description: 'Optimise for purchases and conversions', defaultOptGoal: 'CONVERT' },
  { value: 'AWARENESS', label: 'Awareness', description: 'Maximise impressions and reach', defaultOptGoal: 'REACH' },
  { value: 'ENGAGEMENT', label: 'Engagement', description: 'Grow followers and drive interactions', defaultOptGoal: 'IMPRESSION' },
]

const OBJECTIVE_TO_CANONICAL: Record<TkObjective, AdObjective> = {
  TRAFFIC: 'TRAFFIC',
  LEADS: 'LEADS',
  SALES: 'SALES',
  AWARENESS: 'AWARENESS',
  ENGAGEMENT: 'ENGAGEMENT',
}

const OPTIMIZATION_GOALS: { value: TkOptimizationGoal; label: string }[] = [
  { value: 'CLICK', label: 'Click' },
  { value: 'CONVERT', label: 'Convert' },
  { value: 'REACH', label: 'Reach' },
  { value: 'IMPRESSION', label: 'Impression' },
  { value: 'VIDEO_VIEW', label: 'Video view' },
  { value: 'LEAD_GENERATION', label: 'Lead generation' },
]

const BUDGET_MODES: { value: TkBudgetMode; label: string }[] = [
  { value: 'BUDGET_MODE_INFINITE', label: 'No limit' },
  { value: 'BUDGET_MODE_DAY', label: 'Daily cap' },
  { value: 'BUDGET_MODE_TOTAL', label: 'Total cap' },
]

const PLACEMENTS: { value: TkPlacement; label: string }[] = [
  { value: 'PLACEMENT_TIKTOK', label: 'TikTok' },
  { value: 'PLACEMENT_PANGLE', label: 'Pangle' },
  { value: 'PLACEMENT_TOPBUZZ', label: 'TopBuzz' },
]

const CTA_OPTIONS: { value: TkCTA; label: string }[] = [
  { value: 'SHOP_NOW', label: 'Shop Now' },
  { value: 'LEARN_MORE', label: 'Learn More' },
  { value: 'SIGN_UP', label: 'Sign Up' },
  { value: 'DOWNLOAD', label: 'Download' },
  { value: 'CONTACT_US', label: 'Contact Us' },
  { value: 'APPLY_NOW', label: 'Apply Now' },
  { value: 'BOOK_NOW', label: 'Book Now' },
  { value: 'ORDER_NOW', label: 'Order Now' },
]

const STEP_LABELS = ['Campaign', 'AdGroup', 'Ad']

const DEFAULT_TARGETING: TiktokTargetingValue = {
  canonical: {
    geo: { countries: [] },
    demographics: { ageMin: 18, ageMax: 65 },
  },
  tkTargeting: {},
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TiktokCampaignBuilder({ orgId, orgSlug, currency = 'USD', initial, onComplete, onCancel }: Props) {
  const [step, setStep] = useState(0)
  const [step1, setStep1] = useState<Step1State>({
    campaignName: '',
    objective: 'TRAFFIC',
    budgetMajor: '',
    budgetMode: 'BUDGET_MODE_INFINITE',
    ...initial?.step1,
  })
  const [step2, setStep2] = useState<Step2State>({
    adGroupName: '',
    dailyBudgetMajor: 20,
    optimizationGoal: 'CLICK',
    bidType: 'NO_BID',
    bidPriceMajor: '',
    placements: ['PLACEMENT_TIKTOK'],
    pacing: 'PACING_MODE_SMOOTH',
    targeting: DEFAULT_TARGETING,
    ...initial?.step2,
  })
  const [step3, setStep3] = useState<Step3State>({
    adName: '',
    identityId: '',
    identityType: '',
    adText: '',
    callToAction: 'LEARN_MORE',
    landingPageUrl: '',
    displayName: '',
    imageId: '',
    ...initial?.step3,
  })

  const [identities, setIdentities] = useState<AdIdentity[]>([])
  const [identitiesLoading, setIdentitiesLoading] = useState(false)
  const [stepError, setStepError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Fetch identities when we land on Step 3
  useEffect(() => {
    if (step !== 2) return
    setIdentitiesLoading(true)
    fetch('/api/v1/ads/tiktok/identities', {
      headers: {
        'X-Org-Id': orgId,
        'X-Org-Slug': orgSlug,
      },
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          const list: AdIdentity[] = (json.data?.identities ?? []) as AdIdentity[]
          setIdentities(list)
          // Auto-select first if only one
          if (list.length === 1 && !step3.identityId) {
            setStep3((s) => ({
              ...s,
              identityId: list[0].identityId,
              identityType: list[0].identityType,
            }))
          }
        }
      })
      .catch(() => {
        // Non-fatal — user can still proceed with manual input
      })
      .finally(() => setIdentitiesLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // ─── Validation ──────────────────────────────────────────────────────────────

  function validateStep(s: number): string | null {
    if (s === 0) {
      if (!step1.campaignName.trim()) return 'Campaign name is required'
    }
    if (s === 1) {
      if (!step2.adGroupName.trim()) return 'AdGroup name is required'
      if (!step2.dailyBudgetMajor || step2.dailyBudgetMajor <= 0)
        return 'Daily budget must be greater than 0'
    }
    if (s === 2) {
      if (!step3.adName.trim()) return 'Ad name is required'
      if (!step3.identityId.trim()) return 'An identity must be selected'
      if (!step3.adText.trim()) return 'Ad text is required'
      if (!step3.landingPageUrl.trim()) return 'Landing page URL is required'
    }
    return null
  }

  // ─── Navigation ──────────────────────────────────────────────────────────────

  function nextStep() {
    const err = validateStep(step)
    if (err) { setStepError(err); return }
    setStepError(null)
    setStep((s) => s + 1)
  }

  function prevStep() {
    setStepError(null)
    setStep((s) => Math.max(0, s - 1))
  }

  // ─── Objective change — auto-update optimizationGoal ──────────────────────

  function handleObjectiveChange(obj: TkObjective) {
    const defaultGoal = OBJECTIVES.find((o) => o.value === obj)?.defaultOptGoal ?? 'CLICK'
    setStep1((s) => ({ ...s, objective: obj }))
    setStep2((s) => ({ ...s, optimizationGoal: defaultGoal }))
  }

  // ─── Placement toggle ────────────────────────────────────────────────────────

  function togglePlacement(p: TkPlacement) {
    setStep2((s) => {
      const has = s.placements.includes(p)
      const next = has ? s.placements.filter((x) => x !== p) : [...s.placements, p]
      return { ...s, placements: next }
    })
  }

  // ─── API helpers ─────────────────────────────────────────────────────────────

  async function postJSON(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Org-Id': orgId,
        'X-Org-Slug': orgSlug,
      },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.error ?? `HTTP ${res.status}`)
    return (json.data ?? json) as Record<string, unknown>
  }

  // ─── Submit ───────────────────────────────────────────────────────────────────

  async function submit() {
    const err = validateStep(2)
    if (err) { setStepError(err); return }
    setStepError(null)
    setSubmitting(true)
    setSubmitError(null)

    try {
      // Step A: create campaign (PiB AdCampaign)
      const campaignData = await postJSON('/api/v1/ads/campaigns', {
        platform: 'tiktok',
        input: {
          name: step1.campaignName.trim(),
          objective: OBJECTIVE_TO_CANONICAL[step1.objective],
          status: 'DRAFT',
          cboEnabled: false,
          specialAdCategories: [],
        },
        tiktokAds: {
          budgetMajor:
            step1.budgetMajor !== '' && step1.budgetMode !== 'BUDGET_MODE_INFINITE'
              ? step1.budgetMajor
              : undefined,
          budgetMode: step1.budgetMode,
        },
      })
      const campaignId = (campaignData as { id?: string }).id ?? ''

      // Step B: create adgroup (PiB AdSet)
      const adSetData = await postJSON('/api/v1/ads/ad-sets', {
        platform: 'tiktok',
        input: {
          name: step2.adGroupName.trim(),
          campaignId,
          status: 'DRAFT',
          targeting: step2.targeting.canonical,
        },
        tiktokAds: {
          optimizationGoal: step2.optimizationGoal,
          billingEvent: 'IMPRESSIONS',
          bidType: step2.bidType,
          bidPriceMajor:
            step2.bidType === 'CUSTOM' && step2.bidPriceMajor !== ''
              ? step2.bidPriceMajor
              : undefined,
          budgetMajor: step2.dailyBudgetMajor,
          budgetMode: 'BUDGET_MODE_DAY',
          pacing: step2.pacing,
          placements: step2.placements,
          tkTargeting: step2.targeting.tkTargeting,
        },
      })
      const adSetId = (adSetData as { id?: string }).id ?? ''

      // Step C: create ad (PiB Ad)
      const adData = await postJSON('/api/v1/ads/ads', {
        platform: 'tiktok',
        input: {
          name: step3.adName.trim(),
          adSetId,
          format: 'SINGLE_IMAGE',
        },
        tiktokAds: {
          identityId: step3.identityId.trim(),
          identityType: step3.identityType || 'TT_USER',
          adText: step3.adText.trim(),
          callToAction: step3.callToAction,
          landingPageUrl: step3.landingPageUrl.trim(),
          displayName: step3.displayName.trim() || undefined,
          imageIds: step3.imageId.trim() ? [step3.imageId.trim()] : undefined,
        },
      })
      const adId = (adData as { id?: string }).id ?? ''

      onComplete?.({ campaignId, adSetId, adId })
    } catch (err) {
      setSubmitError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Styles ───────────────────────────────────────────────────────────────────

  const inputCls =
    'mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:border-[#F5A623]/60'
  const labelCls = 'block text-sm font-medium'

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-2xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">New TikTok campaign</h1>
        {onCancel && (
          <button
            type="button"
            className="text-sm text-white/60 underline hover:text-white/80"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>

      {/* Stepper */}
      <ol className="mb-6 flex gap-2 text-xs uppercase tracking-wide">
        {STEP_LABELS.map((label, i) => (
          <li
            key={label}
            className={`flex-1 rounded border px-3 py-1.5 text-center transition-colors ${
              i === step
                ? 'border-[#F5A623] text-[#F5A623]'
                : i < step
                  ? 'border-white/20 text-white/60'
                  : 'border-white/5 text-white/30'
            }`}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {/* ── Step 1: Campaign ──────────────────────────────────────────────────── */}
      {step === 0 && (
        <div className="space-y-5">
          <label className={labelCls}>
            Campaign name
            <input
              className={inputCls}
              value={step1.campaignName}
              onChange={(e) => setStep1((s) => ({ ...s, campaignName: e.target.value }))}
              placeholder="e.g. Brand Awareness — Q3 2026"
              aria-label="Campaign name"
            />
          </label>

          <fieldset>
            <legend className={labelCls}>Objective</legend>
            <div className="mt-2 space-y-2">
              {OBJECTIVES.map((o) => (
                <label
                  key={o.value}
                  className={`flex items-start gap-3 rounded border px-3 py-2 text-sm cursor-pointer transition-colors ${
                    step1.objective === o.value
                      ? 'border-[#F5A623] bg-[#F5A623]/5'
                      : 'border-white/10 hover:bg-white/5'
                  }`}
                >
                  <input
                    type="radio"
                    name="tiktok-objective"
                    checked={step1.objective === o.value}
                    onChange={() => handleObjectiveChange(o.value)}
                    className="mt-0.5"
                    aria-label={o.label}
                  />
                  <div>
                    <div className="font-medium">{o.label}</div>
                    <div className="text-xs text-white/50">{o.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label className={labelCls}>
              Budget mode
              <select
                className={inputCls}
                value={step1.budgetMode}
                onChange={(e) =>
                  setStep1((s) => ({ ...s, budgetMode: e.target.value as TkBudgetMode }))
                }
                aria-label="Budget mode"
              >
                {BUDGET_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </label>
          </div>

          {step1.budgetMode !== 'BUDGET_MODE_INFINITE' && (
            <label className={labelCls}>
              Budget amount ({currency})
              <input
                type="number"
                className={inputCls}
                value={step1.budgetMajor}
                onChange={(e) =>
                  setStep1((s) => ({
                    ...s,
                    budgetMajor: e.target.value === '' ? '' : parseFloat(e.target.value) || 0,
                  }))
                }
                min="0"
                step="0.01"
                placeholder="e.g. 500"
                aria-label="Budget amount"
              />
            </label>
          )}
        </div>
      )}

      {/* ── Step 2: AdGroup ───────────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-5">
          <label className={labelCls}>
            AdGroup name
            <input
              className={inputCls}
              value={step2.adGroupName}
              onChange={(e) => setStep2((s) => ({ ...s, adGroupName: e.target.value }))}
              placeholder="e.g. US 18-34 — May 2026"
              aria-label="AdGroup name"
            />
          </label>

          <label className={labelCls}>
            Daily budget ({currency})
            <input
              type="number"
              className={inputCls}
              value={step2.dailyBudgetMajor}
              onChange={(e) =>
                setStep2((s) => ({ ...s, dailyBudgetMajor: parseFloat(e.target.value) || 0 }))
              }
              min="0.01"
              step="0.01"
              aria-label="Daily budget"
            />
          </label>

          <div>
            <label className={labelCls}>
              Optimization goal
              <select
                className={inputCls}
                value={step2.optimizationGoal}
                onChange={(e) =>
                  setStep2((s) => ({ ...s, optimizationGoal: e.target.value as TkOptimizationGoal }))
                }
                aria-label="Optimization goal"
              >
                {OPTIMIZATION_GOALS.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </label>
          </div>

          <fieldset>
            <legend className={labelCls}>Bid type</legend>
            <div className="mt-2 flex gap-3">
              {(['NO_BID', 'CUSTOM'] as const).map((bt) => (
                <label
                  key={bt}
                  className={`flex items-center gap-2 rounded border px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                    step2.bidType === bt
                      ? 'border-[#F5A623] bg-[#F5A623]/5 text-[#F5A623]'
                      : 'border-white/10 text-white/60 hover:bg-white/5'
                  }`}
                >
                  <input
                    type="radio"
                    name="tiktok-bid-type"
                    checked={step2.bidType === bt}
                    onChange={() => setStep2((s) => ({ ...s, bidType: bt }))}
                    className="sr-only"
                    aria-label={bt}
                  />
                  {bt === 'NO_BID' ? 'Auto bid' : 'Custom bid'}
                </label>
              ))}
            </div>
          </fieldset>

          {step2.bidType === 'CUSTOM' && (
            <label className={labelCls}>
              Bid price ({currency})
              <input
                type="number"
                className={inputCls}
                value={step2.bidPriceMajor}
                onChange={(e) =>
                  setStep2((s) => ({
                    ...s,
                    bidPriceMajor: e.target.value === '' ? '' : parseFloat(e.target.value) || 0,
                  }))
                }
                min="0.01"
                step="0.01"
                placeholder="e.g. 0.50"
                aria-label="Bid price"
              />
            </label>
          )}

          <fieldset>
            <legend className={labelCls}>Placements</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {PLACEMENTS.map((p) => (
                <label
                  key={p.value}
                  className={`flex items-center gap-2 rounded border px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                    step2.placements.includes(p.value)
                      ? 'border-[#F5A623] bg-[#F5A623]/5 text-[#F5A623]'
                      : 'border-white/10 text-white/60 hover:bg-white/5'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={step2.placements.includes(p.value)}
                    onChange={() => togglePlacement(p.value)}
                    aria-label={p.label}
                  />
                  {p.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className={labelCls}>Pacing</legend>
            <div className="mt-2 flex gap-3">
              {([
                { value: 'PACING_MODE_SMOOTH', label: 'Smooth' },
                { value: 'PACING_MODE_FAST', label: 'Fast' },
              ] as const).map((p) => (
                <label
                  key={p.value}
                  className={`flex items-center gap-2 rounded border px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                    step2.pacing === p.value
                      ? 'border-[#F5A623] bg-[#F5A623]/5 text-[#F5A623]'
                      : 'border-white/10 text-white/60 hover:bg-white/5'
                  }`}
                >
                  <input
                    type="radio"
                    name="tiktok-pacing"
                    checked={step2.pacing === p.value}
                    onChange={() => setStep2((s) => ({ ...s, pacing: p.value }))}
                    className="sr-only"
                    aria-label={p.label}
                  />
                  {p.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <span className={`${labelCls} mb-3`}>Targeting</span>
            <div className="mt-3 rounded border border-white/10 bg-white/[0.02] p-4">
              <TiktokTargetingEditor
                value={step2.targeting}
                onChange={(targeting) => setStep2((s) => ({ ...s, targeting }))}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3: Ad ────────────────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-5">
          <label className={labelCls}>
            Ad name
            <input
              className={inputCls}
              value={step3.adName}
              onChange={(e) => setStep3((s) => ({ ...s, adName: e.target.value }))}
              placeholder="e.g. Hero video — May 2026"
              aria-label="Ad name"
            />
          </label>

          {/* Identity picker */}
          <div>
            <label className={labelCls}>
              TikTok identity (poster account)
              {identitiesLoading ? (
                <p className="mt-2 text-sm text-white/40">Loading identities…</p>
              ) : identities.length === 0 ? (
                <p className="mt-2 rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-300">
                  No identities found — make sure a TikTok user has been linked to this
                  advertiser in TikTok Business Center.
                </p>
              ) : (
                <select
                  className={inputCls}
                  value={step3.identityId}
                  onChange={(e) => {
                    const chosen = identities.find((id) => id.identityId === e.target.value)
                    setStep3((s) => ({
                      ...s,
                      identityId: e.target.value,
                      identityType: chosen?.identityType ?? 'TT_USER',
                    }))
                  }}
                  aria-label="TikTok identity"
                >
                  <option value="">— select an identity —</option>
                  {identities.map((id) => (
                    <option key={id.identityId} value={id.identityId}>
                      {id.displayName ? `${id.displayName} (${id.identityId})` : id.identityId}
                    </option>
                  ))}
                </select>
              )}
            </label>
          </div>

          {/* Ad text */}
          <div>
            <label className={labelCls}>
              Ad text
              <textarea
                className={`${inputCls} min-h-[80px]`}
                value={step3.adText}
                maxLength={100}
                onChange={(e) => setStep3((s) => ({ ...s, adText: e.target.value }))}
                placeholder="Your ad copy (max 100 characters)"
                aria-label="Ad text"
              />
            </label>
            <p className="mt-1 text-xs text-white/40 text-right">
              {step3.adText.length} / 100
            </p>
          </div>

          {/* Call to action */}
          <div>
            <label className={labelCls}>
              Call to action
              <select
                className={inputCls}
                value={step3.callToAction}
                onChange={(e) => setStep3((s) => ({ ...s, callToAction: e.target.value as TkCTA }))}
                aria-label="Call to action"
              >
                {CTA_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Landing page URL */}
          <label className={labelCls}>
            Landing page URL
            <input
              type="url"
              className={inputCls}
              value={step3.landingPageUrl}
              onChange={(e) => setStep3((s) => ({ ...s, landingPageUrl: e.target.value }))}
              placeholder="https://example.com/landing"
              aria-label="Landing page URL"
            />
          </label>

          {/* Display name */}
          <label className={labelCls}>
            Display name (optional)
            <input
              className={inputCls}
              value={step3.displayName}
              onChange={(e) => setStep3((s) => ({ ...s, displayName: e.target.value }))}
              placeholder="Your brand name on TikTok"
              aria-label="Display name"
            />
          </label>

          {/* Creative reference */}
          <div>
            <label className={labelCls}>
              Image ID (TikTok asset ID)
              <input
                className={inputCls}
                value={step3.imageId}
                onChange={(e) => setStep3((s) => ({ ...s, imageId: e.target.value }))}
                placeholder="Paste TikTok image asset ID (uploaded separately)"
                aria-label="Image ID"
              />
            </label>
            <div className="mt-2 rounded border border-white/10 bg-white/[0.02] p-3 text-xs text-white/50">
              <p className="font-medium text-white/70 mb-1">Phase 2 — manual asset ID</p>
              <p>
                Upload your image in TikTok Ads Manager and paste the asset ID here. Phase
                3 will replace this with a native Creative Sync upload step.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Errors */}
      {(stepError ?? submitError) && (
        <p className="mt-4 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {stepError ?? submitError}
        </p>
      )}

      {/* Navigation */}
      <div className="mt-6 flex justify-between gap-2">
        <button
          type="button"
          className="btn-pib-ghost text-sm"
          onClick={prevStep}
          disabled={step === 0 || submitting}
        >
          Back
        </button>
        {step < 2 ? (
          <button
            type="button"
            className="btn-pib-accent text-sm"
            onClick={nextStep}
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            className="btn-pib-accent text-sm"
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? 'Creating…' : 'Create campaign'}
          </button>
        )}
      </div>
    </div>
  )
}
