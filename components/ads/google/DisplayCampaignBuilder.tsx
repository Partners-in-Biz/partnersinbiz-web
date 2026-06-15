'use client'
// components/ads/google/DisplayCampaignBuilder.tsx
// 3-step wizard for Google Display campaign creation.
// Sub-3a Phase 3 Batch 2 Agent D.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AdObjective } from '@/lib/ads/types'
import type { RdaAssets } from '@/lib/ads/providers/google/display-types'
import { RdaAssetEditor } from './RdaAssetEditor'

interface Props {
  orgId: string
  orgSlug: string
  onCancel?: () => void
}

interface Step1State {
  campaignName: string
  objective: AdObjective
  dailyBudgetMajor: number
}

interface Step2State {
  adGroupName: string
}

const DEFAULT_RDA: RdaAssets = {
  marketingImages: [''],
  squareMarketingImages: [''],
  headlines: [''],
  longHeadlines: [''],
  descriptions: [''],
  businessName: '',
  finalUrls: [''],
}

const OBJECTIVES: { value: AdObjective; label: string; description: string }[] = [
  { value: 'AWARENESS', label: 'Awareness', description: 'Maximise impressions and reach across the Display Network' },
  { value: 'TRAFFIC', label: 'Traffic', description: 'Drive clicks to the client website' },
  { value: 'LEADS', label: 'Leads', description: 'Collect leads from interested users' },
  { value: 'SALES', label: 'Sales', description: 'Optimise for purchases and conversions' },
]

const STEP_LABELS = ['Basics', 'Ad Group', 'First RDA']

export function DisplayCampaignBuilder({ orgId, orgSlug, onCancel }: Props) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [step1, setStep1] = useState<Step1State>({
    campaignName: '',
    objective: 'AWARENESS',
    dailyBudgetMajor: 10,
  })
  const [step2, setStep2] = useState<Step2State>({
    adGroupName: '',
  })
  const [rda, setRda] = useState<RdaAssets>(DEFAULT_RDA)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [stepError, setStepError] = useState<string | null>(null)

  function validateStep(s: number): string | null {
    if (s === 0) {
      if (!step1.campaignName.trim()) return 'Campaign name is required'
      if (!step1.dailyBudgetMajor || step1.dailyBudgetMajor <= 0)
        return 'Daily budget must be greater than 0'
    }
    if (s === 1) {
      if (!step2.adGroupName.trim()) return 'Ad group name is required'
    }
    if (s === 2) {
      // Marketing images
      const cleanMi = rda.marketingImages.filter((u) => u.trim())
      if (cleanMi.length < 1) return 'At least 1 marketing image URL is required'
      if (cleanMi.length > 15) return 'Maximum 15 marketing images allowed'

      // Square marketing images
      const cleanSmi = rda.squareMarketingImages.filter((u) => u.trim())
      if (cleanSmi.length < 1) return 'At least 1 square marketing image URL is required'
      if (cleanSmi.length > 15) return 'Maximum 15 square marketing images allowed'

      // Headlines (1-5, max 30 chars)
      const cleanH = rda.headlines.filter((h) => h.trim())
      if (cleanH.length < 1) return 'At least 1 headline is required'
      if (cleanH.length > 5) return 'Maximum 5 headlines allowed'
      const overH = cleanH.find((h) => h.length > 30)
      if (overH) return `Headline exceeds 30 chars: "${overH}"`

      // Long headlines (1-5, max 90 chars)
      const cleanLh = rda.longHeadlines.filter((h) => h.trim())
      if (cleanLh.length < 1) return 'At least 1 long headline is required'
      if (cleanLh.length > 5) return 'Maximum 5 long headlines allowed'
      const overLh = cleanLh.find((h) => h.length > 90)
      if (overLh) return `Long headline exceeds 90 chars`

      // Descriptions (1-5, max 90 chars)
      const cleanD = rda.descriptions.filter((d) => d.trim())
      if (cleanD.length < 1) return 'At least 1 description is required'
      if (cleanD.length > 5) return 'Maximum 5 descriptions allowed'
      const overD = cleanD.find((d) => d.length > 90)
      if (overD) return `Description exceeds 90 chars`

      // Business name
      if (!rda.businessName.trim()) return 'Business name is required'

      // Landing URLs
      const cleanUrls = rda.finalUrls.filter((u) => u.trim())
      if (cleanUrls.length < 1) return 'At least one landing URL is required'
    }
    return null
  }

  function nextStep() {
    const err = validateStep(step)
    if (err) {
      setStepError(err)
      return
    }
    setStepError(null)
    setStep((s) => s + 1)
  }

  function prevStep() {
    setStepError(null)
    setStep((s) => Math.max(0, s - 1))
  }

  async function postJSON(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.error ?? `HTTP ${res.status}`)
    return json.data as Record<string, unknown>
  }

  async function submit() {
    const err = validateStep(2)
    if (err) {
      setStepError(err)
      return
    }
    setStepError(null)
    setSubmitting(true)
    setSubmitError(null)

    try {
      // Step A: create campaign
      const campaignData = await postJSON('/api/v1/ads/campaigns', {
        platform: 'google',
        name: step1.campaignName.trim(),
        objective: step1.objective,
        googleAds: {
          campaignType: 'DISPLAY',
          dailyBudgetMajor: step1.dailyBudgetMajor,
        },
      })
      const campaignId = (campaignData as { campaign?: { id: string }; id?: string }).campaign?.id
        ?? (campaignData as { id?: string }).id
        ?? ''

      // Step B: create ad group
      const adSetData = await postJSON('/api/v1/ads/ad-sets', {
        platform: 'google',
        campaignId,
        name: step2.adGroupName.trim(),
        googleAds: { type: 'DISPLAY_STANDARD' },
        optimizationGoal: 'LINK_CLICKS',
        billingEvent: 'LINK_CLICKS',
        targeting: { geo: {}, demographics: {} },
        placements: [],
      })
      const adSetId = (adSetData as { adSet?: { id: string }; id?: string }).adSet?.id
        ?? (adSetData as { id?: string }).id
        ?? ''

      // Step C: create RDA — strip empty values
      const cleanRda: RdaAssets = {
        marketingImages: rda.marketingImages.filter((u) => u.trim()),
        squareMarketingImages: rda.squareMarketingImages.filter((u) => u.trim()),
        logoImages: rda.logoImages?.filter((u) => u.trim()),
        squareLogoImages: rda.squareLogoImages?.filter((u) => u.trim()),
        headlines: rda.headlines.filter((h) => h.trim()),
        longHeadlines: rda.longHeadlines.filter((h) => h.trim()),
        descriptions: rda.descriptions.filter((d) => d.trim()),
        businessName: rda.businessName.trim(),
        finalUrls: rda.finalUrls.filter((u) => u.trim()),
        callToActionText: rda.callToActionText,
      }
      await postJSON('/api/v1/ads/ads', {
        platform: 'google',
        adSetId,
        name: 'RDA #1',
        rdaAssets: cleanRda,
        status: 'DRAFT',
        format: 'SINGLE_IMAGE',
      })

      router.push(`/admin/org/${orgSlug}/ads/campaigns/${campaignId}`)
    } catch (err) {
      setSubmitError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls =
    'mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:border-[#F5A623]/60'
  const labelCls = 'block text-sm font-medium'

  return (
    <div className="mx-auto max-w-2xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">New Google Display campaign</h1>
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

      {/* Step 1: Basics */}
      {step === 0 && (
        <div className="space-y-5">
          <label className={labelCls}>
            Campaign name
            <input
              className={inputCls}
              value={step1.campaignName}
              onChange={(e) => setStep1((s) => ({ ...s, campaignName: e.target.value }))}
              placeholder="e.g. Display Awareness — May 2026"
              aria-label="Campaign name"
            />
          </label>

          <div>
            <span className={labelCls}>Daily budget (USD)</span>
            <input
              type="number"
              className={inputCls}
              value={step1.dailyBudgetMajor}
              onChange={(e) =>
                setStep1((s) => ({ ...s, dailyBudgetMajor: parseFloat(e.target.value) || 0 }))
              }
              min="0.01"
              step="0.01"
              aria-label="Daily budget"
            />
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
                    name="display-objective"
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

      {/* Step 2: Ad Group */}
      {step === 1 && (
        <div className="space-y-5">
          <label className={labelCls}>
            Ad group name
            <input
              className={inputCls}
              value={step2.adGroupName}
              onChange={(e) => setStep2((s) => ({ ...s, adGroupName: e.target.value }))}
              placeholder="e.g. Prospecting — All Audiences"
              aria-label="Ad group name"
            />
          </label>

          <div className="rounded border border-white/10 bg-white/[0.02] p-4 text-sm text-white/50">
            <p>
              Display ad groups use <strong className="text-white/70">Maximise Conversions</strong>{' '}
              bidding by default — no manual CPC bid required. Targeting and audience settings can
              be refined after creation from the ad group detail page.
            </p>
          </div>
        </div>
      )}

      {/* Step 3: First RDA */}
      {step === 2 && (
        <RdaAssetEditor
          value={rda}
          onChange={setRda}
          disabled={submitting}
        />
      )}

      {/* Step / submit errors */}
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
