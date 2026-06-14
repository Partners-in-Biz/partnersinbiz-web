'use client'
// components/ads/google/ShoppingCampaignBuilder.tsx
// 3-step wizard for Google Shopping campaign creation.
// Sub-3a Phase 4 Batch 2 Agent D.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AdObjective } from '@/lib/ads/types'
import type { AdMerchantCenter } from '@/lib/ads/types'

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
  merchantId: string
  feedLabel: string
}

interface Step3State {
  adGroupName: string
}

// Shopping uses SALES as the primary objective; TRAFFIC as fallback
const OBJECTIVES: { value: AdObjective; label: string; description: string }[] = [
  { value: 'SALES', label: 'Sales', description: 'Optimise for purchases and conversions (recommended for Shopping)' },
  { value: 'TRAFFIC', label: 'Traffic', description: 'Drive clicks to client product pages' },
]

const STEP_LABELS = ['Basics', 'Merchant Center', 'Ad Group']

// Shape returned by the MC bindings endpoint (includes optional primaryFeedLabel)
type MCBinding = AdMerchantCenter & { primaryFeedLabel?: string }

export function ShoppingCampaignBuilder({ orgId, orgSlug, onCancel }: Props) {
  const router = useRouter()
  const [step, setStep] = useState(0)

  const [step1, setStep1] = useState<Step1State>({
    campaignName: '',
    objective: 'SALES',
    dailyBudgetMajor: 5,
  })

  const [step2, setStep2] = useState<Step2State>({
    merchantId: '',
    feedLabel: '',
  })

  const [step3, setStep3] = useState<Step3State>({
    adGroupName: '',
  })

  const [bindings, setBindings] = useState<MCBinding[]>([])
  const [bindingsLoading, setBindingsLoading] = useState(false)
  const [bindingsError, setBindingsError] = useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [stepError, setStepError] = useState<string | null>(null)

  // Fetch MC bindings when user reaches step 2
  useEffect(() => {
    if (step !== 1) return
    let cancelled = false
    setBindingsLoading(true)
    setBindingsError(null)
    ;(async () => {
      try {
        const res = await fetch('/api/v1/ads/google/merchant-center', {
          headers: { 'X-Org-Id': orgId },
        })
        const body = await res.json()
        if (cancelled) return
        if (!body.success) {
          setBindingsError(body.error ?? `HTTP ${res.status}`)
          setBindings([])
        } else {
          const list = (body.data?.bindings ?? []) as MCBinding[]
          setBindings(list)
          // Auto-select first binding
          if (list.length > 0) {
            const first = list[0]
            const defaultLabel =
              first.primaryFeedLabel ??
              (first.feedLabels && first.feedLabels.length > 0 ? first.feedLabels[0] : '')
            setStep2({ merchantId: first.merchantId, feedLabel: defaultLabel })
          }
        }
      } catch (err) {
        if (!cancelled) setBindingsError((err as Error).message)
      } finally {
        if (!cancelled) setBindingsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [step, orgId])

  // Derive feed labels for the currently selected merchantId
  const selectedBinding = bindings.find((b) => b.merchantId === step2.merchantId)
  const feedLabelOptions = selectedBinding?.feedLabels ?? []

  function validateStep(s: number): string | null {
    if (s === 0) {
      if (!step1.campaignName.trim()) return 'Campaign name is required'
      if (!step1.dailyBudgetMajor || step1.dailyBudgetMajor <= 0)
        return 'Daily budget must be greater than 0'
    }
    if (s === 1) {
      if (!step2.merchantId) return 'Please select a Merchant Center account'
      if (!step2.feedLabel) return 'Please select a feed label'
    }
    if (s === 2) {
      if (!step3.adGroupName.trim()) return 'Ad group name is required'
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
          campaignType: 'SHOPPING',
          dailyBudgetMajor: step1.dailyBudgetMajor,
          shopping: {
            merchantId: step2.merchantId,
            feedLabel: step2.feedLabel,
          },
        },
      })
      const campaignId =
        (campaignData as { campaign?: { id: string }; id?: string }).campaign?.id ??
        (campaignData as { id?: string }).id ??
        ''

      // Step B: create ad group
      const adSetData = await postJSON('/api/v1/ads/ad-sets', {
        platform: 'google',
        campaignId,
        name: step3.adGroupName.trim(),
        googleAds: { type: 'SHOPPING_PRODUCT_ADS' },
        optimizationGoal: 'LINK_CLICKS',
        billingEvent: 'LINK_CLICKS',
        targeting: { geo: {}, demographics: {} },
        placements: [],
      })
      const adSetId =
        (adSetData as { adSet?: { id: string }; id?: string }).adSet?.id ??
        (adSetData as { id?: string }).id ??
        ''

      // Step C: create product ad (auto-generated)
      await postJSON('/api/v1/ads/ads', {
        platform: 'google',
        adSetId,
        name: 'Product ad',
        productAd: true,
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
        <h1 className="text-2xl font-semibold">New Google Shopping campaign</h1>
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
              placeholder="e.g. Shopping — Summer Sale 2026"
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
                    name="shopping-objective"
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

      {/* Step 2: Merchant Center */}
      {step === 1 && (
        <div className="space-y-5">
          {bindingsLoading && (
            <p className="text-sm text-white/40">Loading Merchant Center accounts…</p>
          )}

          {bindingsError && (
            <p className="text-sm text-red-300 rounded border border-red-500/30 bg-red-500/10 px-3 py-2">
              {bindingsError}
            </p>
          )}

          {!bindingsLoading && !bindingsError && bindings.length === 0 && (
            <div className="rounded border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 text-sm">
              <p className="text-yellow-200 font-medium">No Merchant Center account connected</p>
              <p className="text-white/50 mt-1">
                Connect a Merchant Center account before creating a Shopping campaign.
              </p>
              <a
                href={`/admin/org/${orgSlug}/ads/merchant-center`}
                className="mt-2 inline-block text-[#F5A623] underline hover:text-[#F5A623]/80 text-sm"
                aria-label="Connect Merchant Center first"
              >
                Connect Merchant Center →
              </a>
            </div>
          )}

          {!bindingsLoading && bindings.length > 0 && (
            <>
              <div>
                <label className={labelCls}>
                  Merchant Center account
                </label>
                <select
                  className={inputCls}
                  value={step2.merchantId}
                  onChange={(e) => {
                    const mid = e.target.value
                    const binding = bindings.find((b) => b.merchantId === mid)
                    const defaultLabel =
                      binding?.primaryFeedLabel ??
                      (binding?.feedLabels && binding.feedLabels.length > 0
                        ? binding.feedLabels[0]
                        : '')
                    setStep2({ merchantId: mid, feedLabel: defaultLabel })
                  }}
                  aria-label="Merchant Center account"
                >
                  <option value="">— select account —</option>
                  {bindings.map((b) => (
                    <option key={b.merchantId} value={b.merchantId}>
                      Merchant ID: {b.merchantId}
                    </option>
                  ))}
                </select>
              </div>

              {step2.merchantId && feedLabelOptions.length > 0 && (
                <div>
                  <label className={labelCls}>
                    Feed label
                  </label>
                  <select
                    className={inputCls}
                    value={step2.feedLabel}
                    onChange={(e) => setStep2((s) => ({ ...s, feedLabel: e.target.value }))}
                    aria-label="Feed label"
                  >
                    <option value="">— select feed label —</option>
                    {feedLabelOptions.map((label) => (
                      <option key={label} value={label}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {step2.merchantId && feedLabelOptions.length === 0 && (
                <p className="text-xs text-white/40">
                  No feed labels found for this account.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Step 3: Ad Group */}
      {step === 2 && (
        <div className="space-y-5">
          <label className={labelCls}>
            Ad group name
            <input
              className={inputCls}
              value={step3.adGroupName}
              onChange={(e) => setStep3((s) => ({ ...s, adGroupName: e.target.value }))}
              placeholder="e.g. All Products"
              aria-label="Ad group name"
            />
          </label>

          <div className="rounded border border-white/10 bg-white/[0.02] p-4 text-sm text-white/50">
            <p>
              Shopping campaigns use <strong className="text-white/70">Product ads</strong> —
              Google automatically pulls product titles, images, and prices from the client Merchant
              Center feed. No ad creative assets are required.
            </p>
          </div>
        </div>
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
