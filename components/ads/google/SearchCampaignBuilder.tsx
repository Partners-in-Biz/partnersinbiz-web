'use client'
// components/ads/google/SearchCampaignBuilder.tsx
// 3-step wizard for Google Search campaign creation.
// Sub-3a Phase 2 Batch 4.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AdObjective } from '@/lib/ads/types'
import { RsaAssetEditor } from './RsaAssetEditor'
import type { RsaAssets } from './RsaAssetEditor'

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
  defaultCpcBidMajor: number
}

const DEFAULT_RSA: RsaAssets = {
  headlines: [{ text: '' }, { text: '' }, { text: '' }],
  descriptions: [{ text: '' }, { text: '' }],
  finalUrls: [''],
  path1: undefined,
  path2: undefined,
}

const OBJECTIVES: { value: AdObjective; label: string; description: string }[] = [
  { value: 'TRAFFIC', label: 'Traffic', description: 'Drive clicks to the client website' },
  { value: 'AWARENESS', label: 'Awareness', description: 'Maximise impressions and reach' },
  { value: 'LEADS', label: 'Leads', description: 'Collect leads from interested users' },
  { value: 'SALES', label: 'Sales', description: 'Optimise for purchases and conversions' },
]

const STEP_LABELS = ['Basics', 'Ad Group', 'First RSA']

export function SearchCampaignBuilder({ orgId, orgSlug, onCancel }: Props) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [step1, setStep1] = useState<Step1State>({
    campaignName: '',
    objective: 'TRAFFIC',
    dailyBudgetMajor: 10,
  })
  const [step2, setStep2] = useState<Step2State>({
    adGroupName: '',
    defaultCpcBidMajor: 0.5,
  })
  const [rsa, setRsa] = useState<RsaAssets>(DEFAULT_RSA)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  function validateStep(s: number): string | null {
    if (s === 0) {
      if (!step1.campaignName.trim()) return 'Campaign name is required'
      if (!step1.dailyBudgetMajor || step1.dailyBudgetMajor <= 0) return 'Daily budget must be greater than 0'
    }
    if (s === 1) {
      if (!step2.adGroupName.trim()) return 'Ad group name is required'
      if (!step2.defaultCpcBidMajor || step2.defaultCpcBidMajor <= 0) return 'CPC bid must be greater than 0'
    }
    if (s === 2) {
      const filledHeadlines = rsa.headlines.filter((h) => h.text.trim())
      if (filledHeadlines.length < 3) return 'At least 3 headlines are required'
      const overHeadline = rsa.headlines.find((h) => h.text.length > 30)
      if (overHeadline) return `Headline exceeds 30 chars: "${overHeadline.text}"`
      const filledDescs = rsa.descriptions.filter((d) => d.text.trim())
      if (filledDescs.length < 2) return 'At least 2 descriptions are required'
      const overDesc = rsa.descriptions.find((d) => d.text.length > 90)
      if (overDesc) return `Description exceeds 90 chars`
      if (!rsa.finalUrls[0]?.trim()) return 'At least one landing URL is required'
      if (rsa.path1 && rsa.path1.length > 15) return 'Path 1 exceeds 15 chars'
      if (rsa.path2 && rsa.path2.length > 15) return 'Path 2 exceeds 15 chars'
    }
    return null
  }

  const [stepError, setStepError] = useState<string | null>(null)

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
        input: {
          name: step1.campaignName.trim(),
          objective: step1.objective,
          status: 'DRAFT',
          cboEnabled: false,
          specialAdCategories: [],
        },
        googleAds: {
          dailyBudgetMajor: step1.dailyBudgetMajor,
        },
      })
      const campaignId = (campaignData as { id?: string }).id ?? ''

      // Step B: create ad group
      const adSetData = await postJSON('/api/v1/ads/ad-sets', {
        platform: 'google',
        input: {
          campaignId,
          name: step2.adGroupName.trim(),
          status: 'DRAFT',
          optimizationGoal: 'LINK_CLICKS',
          billingEvent: 'LINK_CLICKS',
          targeting: {
            geo: {},
            demographics: { ageMin: 18, ageMax: 65 },
          },
          placements: {
            feeds: false,
            stories: false,
            reels: false,
            marketplace: false,
          },
        },
        googleAds: {
          defaultCpcBidMajor: step2.defaultCpcBidMajor,
        },
      })
      const adSetId = (adSetData as { id?: string }).id ?? ''

      // Step C: create RSA — strip empty headlines/descriptions
      const cleanRsa: RsaAssets = {
        headlines: rsa.headlines.filter((h) => h.text.trim()),
        descriptions: rsa.descriptions.filter((d) => d.text.trim()),
        finalUrls: rsa.finalUrls.filter((u) => u.trim()),
        path1: rsa.path1 || undefined,
        path2: rsa.path2 || undefined,
      }
      await postJSON('/api/v1/ads/ads', {
        platform: 'google',
        input: {
          adSetId,
          campaignId,
          name: 'RSA #1',
          status: 'DRAFT',
          format: 'SINGLE_IMAGE', // canonical ad format field — RSA is identified via rsaAssets
          creativeIds: [],
          copy: {
            primaryText: '',
            headline: cleanRsa.headlines[0]?.text ?? '',
            destinationUrl: cleanRsa.finalUrls[0] ?? '',
          },
        },
        rsaAssets: cleanRsa,
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
        <h1 className="text-2xl font-semibold">New Google Search campaign</h1>
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
              placeholder="e.g. Brand Search — May 2026"
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
                    name="google-objective"
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
              placeholder="e.g. Brand Keywords"
              aria-label="Ad group name"
            />
          </label>

          <label className={labelCls}>
            Default CPC bid (USD)
            <input
              type="number"
              className={inputCls}
              value={step2.defaultCpcBidMajor}
              onChange={(e) =>
                setStep2((s) => ({
                  ...s,
                  defaultCpcBidMajor: parseFloat(e.target.value) || 0,
                }))
              }
              min="0.01"
              step="0.01"
              aria-label="Default CPC bid"
            />
          </label>

          <div className="rounded border border-white/10 bg-white/[0.02] p-4 text-sm text-white/50">
            <p>
              Keywords for this ad group can be added after the campaign is created, from the
              ad group detail page.
            </p>
          </div>
        </div>
      )}

      {/* Step 3: First RSA */}
      {step === 2 && (
        <RsaAssetEditor
          value={rsa}
          onChange={setRsa}
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
