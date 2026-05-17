'use client'
// components/ads/LinkedinCampaignBuilder.tsx
// 3-step wizard for LinkedIn campaign creation.
// Step 1 — Campaign Group (PiB AdCampaign)
// Step 2 — Campaign / AdSet (PiB AdSet)
// Step 3 — Creative / Ad (PiB Ad)
// Sub-3b Phase 2 Batch 3C.

import { useState } from 'react'
import type { AdObjective } from '@/lib/ads/types'
import { LinkedinTargetingEditor } from './LinkedinTargetingEditor'
import type { LinkedinTargetingValue } from './LinkedinTargetingEditor'

// ─── Types ────────────────────────────────────────────────────────────────────

type LiCampaignType = 'SPONSORED_UPDATES' | 'TEXT_AD' | 'SPONSORED_INMAILS' | 'DYNAMIC'
type LiCostType = 'CPM' | 'CPC' | 'CPV' | 'CPA'
type AdInitialStatus = 'DRAFT' | 'PAUSED'

interface Step1State {
  groupName: string
  totalBudgetMajor: number | ''
  currencyCode: string
  objective: AdObjective
}

interface Step2State {
  campaignName: string
  campaignType: LiCampaignType
  costType: LiCostType
  dailyBudgetMajor: number
  targeting: LinkedinTargetingValue
}

interface Step3State {
  creativeName: string
  referenceUrn: string
  status: AdInitialStatus
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

const OBJECTIVES: { value: AdObjective; label: string; description: string }[] = [
  { value: 'AWARENESS', label: 'Awareness', description: 'Maximise impressions and reach' },
  { value: 'TRAFFIC', label: 'Traffic', description: 'Drive clicks to your website or landing page' },
  { value: 'ENGAGEMENT', label: 'Engagement', description: 'Grow followers and drive interactions' },
  { value: 'LEADS', label: 'Leads', description: 'Collect leads via LinkedIn Lead Gen Forms' },
  { value: 'SALES', label: 'Sales', description: 'Optimise for purchases and conversions' },
]

const CAMPAIGN_TYPES: { value: LiCampaignType; label: string }[] = [
  { value: 'SPONSORED_UPDATES', label: 'Sponsored Content' },
  { value: 'TEXT_AD', label: 'Text Ad' },
  { value: 'SPONSORED_INMAILS', label: 'Sponsored InMail / Message Ad' },
  { value: 'DYNAMIC', label: 'Dynamic Ad' },
]

const DEFAULT_COST_TYPE: Record<LiCampaignType, LiCostType> = {
  SPONSORED_UPDATES: 'CPM',
  TEXT_AD: 'CPC',
  SPONSORED_INMAILS: 'CPM',
  DYNAMIC: 'CPM',
}

const COST_TYPES: { value: LiCostType; label: string }[] = [
  { value: 'CPM', label: 'CPM — cost per 1,000 impressions' },
  { value: 'CPC', label: 'CPC — cost per click' },
  { value: 'CPV', label: 'CPV — cost per video view' },
  { value: 'CPA', label: 'CPA — cost per action' },
]

const STEP_LABELS = ['Campaign Group', 'Campaign', 'Creative']

const DEFAULT_TARGETING: LinkedinTargetingValue = {
  canonical: { geo: { countries: ['US'] }, demographics: { ageMin: 18, ageMax: 65 } },
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LinkedinCampaignBuilder({ orgId, orgSlug, currency = 'USD', initial, onComplete, onCancel }: Props) {
  const [step, setStep] = useState(0)
  const [step1, setStep1] = useState<Step1State>({
    groupName: '',
    totalBudgetMajor: '',
    currencyCode: currency,
    objective: 'TRAFFIC',
    ...initial?.step1,
  })
  const [step2, setStep2] = useState<Step2State>({
    campaignName: '',
    campaignType: 'SPONSORED_UPDATES',
    costType: 'CPM',
    dailyBudgetMajor: 10,
    targeting: DEFAULT_TARGETING,
    ...initial?.step2,
  })
  const [step3, setStep3] = useState<Step3State>({
    creativeName: '',
    referenceUrn: '',
    status: 'DRAFT',
    ...initial?.step3,
  })

  const [stepError, setStepError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // ─── Validation ───────────────────────────────────────────────────────────

  function validateStep(s: number): string | null {
    if (s === 0) {
      if (!step1.groupName.trim()) return 'Campaign group name is required'
    }
    if (s === 1) {
      if (!step2.campaignName.trim()) return 'Campaign name is required'
      if (!step2.dailyBudgetMajor || step2.dailyBudgetMajor <= 0)
        return 'Daily budget must be greater than 0'
    }
    if (s === 2) {
      if (!step3.creativeName.trim()) return 'Creative name is required'
      if (!step3.referenceUrn.trim())
        return 'Reference URN is required (Share URN or asset URN)'
    }
    return null
  }

  // ─── Navigation ──────────────────────────────────────────────────────────

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

  // ─── API helpers ─────────────────────────────────────────────────────────

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

  // ─── Submit ───────────────────────────────────────────────────────────────

  async function submit() {
    const err = validateStep(2)
    if (err) { setStepError(err); return }
    setStepError(null)
    setSubmitting(true)
    setSubmitError(null)

    try {
      // Step A: create campaign group (PiB AdCampaign)
      const campaignData = await postJSON('/api/v1/ads/campaigns', {
        platform: 'linkedin',
        input: {
          name: step1.groupName.trim(),
          objective: step1.objective,
          status: 'DRAFT',
          cboEnabled: false,
          specialAdCategories: [],
        },
        linkedinAds: {
          totalBudgetMajor: step1.totalBudgetMajor !== '' ? step1.totalBudgetMajor : undefined,
          currencyCode: step1.currencyCode,
        },
      })
      const campaignId = (campaignData as { id?: string }).id ?? ''

      // Step B: create campaign (PiB AdSet)
      const adSetData = await postJSON('/api/v1/ads/ad-sets', {
        platform: 'linkedin',
        input: {
          campaignId,
          name: step2.campaignName.trim(),
          status: 'DRAFT',
          targeting: step2.targeting.canonical,
        },
        linkedinAds: {
          campaignType: step2.campaignType,
          costType: step2.costType,
          dailyBudgetMajor: step2.dailyBudgetMajor,
          currencyCode: step1.currencyCode,
          liTargetingCriteria: step2.targeting.liTargetingCriteria,
        },
      })
      const adSetId = (adSetData as { id?: string }).id ?? ''

      // Step C: create creative (PiB Ad)
      const adData = await postJSON('/api/v1/ads/ads', {
        platform: 'linkedin',
        input: {
          adSetId,
          campaignId,
          name: step3.creativeName.trim(),
          status: step3.status,
          format: 'SINGLE_IMAGE',
          creativeIds: [],
          copy: { primaryText: '', headline: '', destinationUrl: '' },
        },
        linkedinAds: {
          referenceUrn: step3.referenceUrn.trim(),
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

  // ─── Derived helpers ──────────────────────────────────────────────────────

  function handleCampaignTypeChange(ct: LiCampaignType) {
    setStep2((s) => ({ ...s, campaignType: ct, costType: DEFAULT_COST_TYPE[ct] }))
  }

  // ─── Styles ───────────────────────────────────────────────────────────────

  const inputCls =
    'mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:border-[#F5A623]/60'
  const labelCls = 'block text-sm font-medium'

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-2xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">New LinkedIn campaign</h1>
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

      {/* ── Step 1: Campaign Group ─────────────────────────────────────────── */}
      {step === 0 && (
        <div className="space-y-5">
          <label className={labelCls}>
            Campaign group name
            <input
              className={inputCls}
              value={step1.groupName}
              onChange={(e) => setStep1((s) => ({ ...s, groupName: e.target.value }))}
              placeholder="e.g. Brand Awareness — Q3 2026"
              aria-label="Campaign group name"
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>
                Total budget (optional)
                <input
                  type="number"
                  className={inputCls}
                  value={step1.totalBudgetMajor}
                  onChange={(e) =>
                    setStep1((s) => ({
                      ...s,
                      totalBudgetMajor: e.target.value === '' ? '' : parseFloat(e.target.value) || 0,
                    }))
                  }
                  min="0"
                  step="0.01"
                  placeholder="No limit"
                  aria-label="Total budget"
                />
              </label>
            </div>
            <div>
              <label className={labelCls}>
                Currency
                <input
                  className={inputCls}
                  value={step1.currencyCode}
                  onChange={(e) => setStep1((s) => ({ ...s, currencyCode: e.target.value.toUpperCase() }))}
                  placeholder="USD"
                  maxLength={3}
                  aria-label="Currency"
                />
              </label>
            </div>
          </div>

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
                    name="linkedin-objective"
                    checked={step1.objective === o.value}
                    onChange={() => setStep1((s) => ({ ...s, objective: o.value }))}
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
        </div>
      )}

      {/* ── Step 2: Campaign (AdSet) ───────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-5">
          <label className={labelCls}>
            Campaign name
            <input
              className={inputCls}
              value={step2.campaignName}
              onChange={(e) => setStep2((s) => ({ ...s, campaignName: e.target.value }))}
              placeholder="e.g. US Decision-makers — May 2026"
              aria-label="Campaign name"
            />
          </label>

          <fieldset>
            <legend className={labelCls}>Campaign type</legend>
            <div className="mt-2 space-y-2">
              {CAMPAIGN_TYPES.map((ct) => (
                <label
                  key={ct.value}
                  className={`flex items-center gap-3 rounded border px-3 py-2 text-sm cursor-pointer transition-colors ${
                    step2.campaignType === ct.value
                      ? 'border-[#F5A623] bg-[#F5A623]/5'
                      : 'border-white/10 hover:bg-white/5'
                  }`}
                >
                  <input
                    type="radio"
                    name="linkedin-campaign-type"
                    checked={step2.campaignType === ct.value}
                    onChange={() => handleCampaignTypeChange(ct.value)}
                    className="mt-0.5"
                    aria-label={ct.label}
                  />
                  <span>{ct.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label className={labelCls}>
              Cost type
              <select
                className={inputCls}
                value={step2.costType}
                onChange={(e) => setStep2((s) => ({ ...s, costType: e.target.value as LiCostType }))}
                aria-label="Cost type"
              >
                {COST_TYPES.map((ct) => (
                  <option key={ct.value} value={ct.value}>{ct.label}</option>
                ))}
              </select>
            </label>
          </div>

          <label className={labelCls}>
            Daily budget ({step1.currencyCode})
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
            <span className={`${labelCls} mb-3`}>Targeting</span>
            <div className="mt-3 rounded border border-white/10 bg-white/[0.02] p-4">
              <LinkedinTargetingEditor
                value={step2.targeting}
                onChange={(targeting) => setStep2((s) => ({ ...s, targeting }))}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3: Creative (Ad) ─────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-5">
          <label className={labelCls}>
            Creative name
            <input
              className={inputCls}
              value={step3.creativeName}
              onChange={(e) => setStep3((s) => ({ ...s, creativeName: e.target.value }))}
              placeholder="e.g. Brand awareness hero — May 2026"
              aria-label="Creative name"
            />
          </label>

          <div>
            <label className={labelCls}>
              Reference URN
              <input
                className={inputCls}
                value={step3.referenceUrn}
                onChange={(e) => setStep3((s) => ({ ...s, referenceUrn: e.target.value }))}
                placeholder="urn:li:share:XXXXXXXXXX"
                aria-label="Reference URN"
              />
            </label>
            <div className="mt-2 rounded border border-white/10 bg-white/[0.02] p-3 text-xs text-white/50">
              <p className="font-medium text-white/70 mb-1">What is a Reference URN?</p>
              <p>
                For <strong>Sponsored Content</strong>, paste an existing LinkedIn Share URN (e.g.{' '}
                <code className="rounded bg-white/10 px-1">urn:li:share:1234567890</code>). For
                other formats, paste an uploaded asset URN. To create or upload new media, call{' '}
                <code className="rounded bg-white/10 px-1">POST /api/v1/ads/creatives/upload</code>{' '}
                first.
              </p>
            </div>
          </div>

          <fieldset>
            <legend className={labelCls}>Initial status</legend>
            <div className="mt-2 flex gap-4">
              {(['DRAFT', 'PAUSED'] as const).map((s) => (
                <label
                  key={s}
                  className={`flex items-center gap-2 rounded border px-4 py-2 text-sm cursor-pointer transition-colors ${
                    step3.status === s
                      ? 'border-[#F5A623] bg-[#F5A623]/5 text-[#F5A623]'
                      : 'border-white/10 text-white/60 hover:bg-white/5'
                  }`}
                >
                  <input
                    type="radio"
                    name="li-creative-status"
                    checked={step3.status === s}
                    onChange={() => setStep3((prev) => ({ ...prev, status: s }))}
                    className="sr-only"
                    aria-label={s}
                  />
                  {s}
                </label>
              ))}
            </div>
          </fieldset>
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
            {submitting ? 'Creating…' : 'Create campaign (as draft)'}
          </button>
        )}
      </div>
    </div>
  )
}
