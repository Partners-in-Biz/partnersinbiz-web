'use client'
import { useState } from 'react'
import type {
  AdObjective,
  AdSetOptimizationGoal,
  AdSetBillingEvent,
  AdSetPlacements,
  AdTargeting,
  AdFormat,
  AdCallToAction,
} from '@/lib/ads/types'
import { BudgetEditor, type BudgetValue } from './BudgetEditor'
import { TargetingEditor } from './TargetingEditor'
import { DiffWarningDialog, type DiffWarning } from './DiffWarningDialog'
import { CreativePicker } from './CreativePicker'

interface Props {
  orgId: string
  orgSlug: string
  /** ISO 4217 currency of the connected ad account; defaults to USD. */
  currency?: string
  /** Optional initial values (e.g. for resuming a draft). */
  initial?: Partial<WizardState>
  /** Called after all three entities are successfully created. */
  onComplete?: (result: { campaignId: string; adSetId: string; adId: string }) => void
  /** Called when user cancels (escape, back-out). */
  onCancel?: () => void
}

interface WizardState {
  // Step 1 - Campaign
  campaignName: string
  objective: AdObjective
  specialAdCategories: string[]
  campaignBudget: BudgetValue

  // Step 2 - AdSet
  adSetName: string
  optimizationGoal: AdSetOptimizationGoal
  billingEvent: AdSetBillingEvent
  targeting: AdTargeting
  placements: AdSetPlacements
  adSetBudget: BudgetValue // ignored if campaign.cboEnabled

  // Step 3 - Ad
  adName: string
  format: AdFormat
  inlineImageUrl: string
  creativeIds: string[]
  primaryText: string
  headline: string
  description: string
  callToAction: AdCallToAction
  destinationUrl: string
}

const DEFAULT_STATE: WizardState = {
  campaignName: '',
  objective: 'TRAFFIC',
  specialAdCategories: [],
  campaignBudget: { shape: 'daily', amount: 5000, cboEnabled: false, bidStrategy: 'LOWEST_COST' },

  adSetName: '',
  optimizationGoal: 'LINK_CLICKS',
  billingEvent: 'IMPRESSIONS',
  targeting: {
    geo: { countries: ['US'] },
    demographics: { ageMin: 18, ageMax: 65 },
    customAudiences: { include: [], exclude: [] },
  },
  placements: { feeds: true, stories: true, reels: false, marketplace: false },
  adSetBudget: { shape: 'daily', amount: 5000 },

  adName: '',
  format: 'SINGLE_IMAGE',
  inlineImageUrl: '',
  creativeIds: [],
  primaryText: '',
  headline: '',
  description: '',
  callToAction: 'LEARN_MORE',
  destinationUrl: '',
}

const OBJECTIVES_MVP: { value: AdObjective; label: string; description: string }[] = [
  { value: 'TRAFFIC', label: 'Traffic', description: 'Send people to a destination off-platform' },
  { value: 'LEADS', label: 'Leads', description: 'Collect leads via Instant Forms' },
  { value: 'SALES', label: 'Sales / Conversions', description: 'Optimize for purchases via Pixel/CAPI' },
]

const OPTIMIZATION_GOALS: AdSetOptimizationGoal[] = [
  'LINK_CLICKS',
  'IMPRESSIONS',
  'REACH',
  'POST_ENGAGEMENT',
  'CONVERSIONS',
  'LEAD_GENERATION',
]

const CTAS: AdCallToAction[] = [
  'SHOP_NOW', 'LEARN_MORE', 'SIGN_UP', 'CONTACT_US', 'GET_OFFER',
  'SUBSCRIBE', 'DOWNLOAD', 'BOOK_NOW', 'APPLY_NOW', 'GET_QUOTE',
]

export function CampaignBuilder({
  orgId,
  orgSlug,
  currency = 'USD',
  initial,
  onComplete,
  onCancel,
}: Props) {
  const [step, setStep] = useState(0)
  const [state, setState] = useState<WizardState>({ ...DEFAULT_STATE, ...initial })
  const [submitting, setSubmitting] = useState(false)
  const [warnings, setWarnings] = useState<DiffWarning[]>([])
  const [showWarn, setShowWarn] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  function patch(p: Partial<WizardState>) {
    setState((s) => ({ ...s, ...p }))
  }

  async function postJSON(path: string, body: unknown): Promise<any> {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.error ?? `HTTP ${res.status}`)
    return json.data
  }

  async function submit() {
    setSubmitting(true)
    setWarnings([])
    try {
      // Step A - create campaign (DRAFT)
      const campaignInput: any = {
        name: state.campaignName,
        objective: state.objective,
        status: 'DRAFT',
        cboEnabled: !!state.campaignBudget.cboEnabled,
        specialAdCategories: state.specialAdCategories,
      }
      if (state.campaignBudget.cboEnabled) {
        if (state.campaignBudget.shape === 'daily') {
          campaignInput.dailyBudget = state.campaignBudget.amount
        } else {
          campaignInput.lifetimeBudget = state.campaignBudget.amount
        }
        campaignInput.bidStrategy = state.campaignBudget.bidStrategy
      }
      const campaign = await postJSON('/api/v1/ads/campaigns', { input: campaignInput })

      // Step B - create adset
      const adSetInput: any = {
        campaignId: campaign.id,
        name: state.adSetName,
        status: 'DRAFT',
        optimizationGoal: state.optimizationGoal,
        billingEvent: state.billingEvent,
        targeting: state.targeting,
        placements: state.placements,
      }
      if (!state.campaignBudget.cboEnabled) {
        if (state.adSetBudget.shape === 'daily') adSetInput.dailyBudget = state.adSetBudget.amount
        else adSetInput.lifetimeBudget = state.adSetBudget.amount
      }
      const adSet = await postJSON('/api/v1/ads/ad-sets', { input: adSetInput })

      // Step C - create ad
      const adInput: any = {
        adSetId: adSet.id,
        campaignId: campaign.id,
        name: state.adName,
        status: 'DRAFT',
        format: state.format,
        creativeIds: state.creativeIds,
        // Phase 2 fallback - only sent when no creativeIds selected
        inlineImageUrl: state.creativeIds.length === 0 ? state.inlineImageUrl : undefined,
        copy: {
          primaryText: state.primaryText,
          headline: state.headline,
          description: state.description || undefined,
          callToAction: state.callToAction,
          destinationUrl: state.destinationUrl,
        },
      }
      const ad = await postJSON('/api/v1/ads/ads', { input: adInput })

      onComplete?.({ campaignId: campaign.id, adSetId: adSet.id, adId: ad.id })
    } catch (err) {
      setWarnings([{ message: (err as Error).message, severity: 'error' }])
      setShowWarn(true)
    } finally {
      setSubmitting(false)
    }
  }

  const stepLabels = ['Campaign', 'Ad Set', 'Ad']

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-medium">New campaign</h1>
        {onCancel && (
          <button type="button" className="text-sm text-white/60 underline" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      <ol className="mb-6 flex gap-2 text-xs uppercase tracking-wide">
        {stepLabels.map((label, i) => (
          <li
            key={label}
            className={`flex-1 rounded border px-3 py-1.5 text-center ${
              i === step
                ? 'border-[var(--sc-accent)] text-[var(--sc-accent)]'
                : i < step
                  ? 'border-white/20 text-white/60'
                  : 'border-white/5 text-white/30'
            }`}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-5">
          <label className="block text-sm">
            <span className="font-medium">Campaign name</span>
            <input
              className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
              value={state.campaignName}
              onChange={(e) => patch({ campaignName: e.target.value })}
              aria-label="Campaign name"
            />
          </label>

          <fieldset>
            <legend className="text-sm font-medium">Objective</legend>
            <div className="mt-2 space-y-2">
              {OBJECTIVES_MVP.map((o) => (
                <label
                  key={o.value}
                  className={`flex items-start gap-3 rounded border px-3 py-2 text-sm cursor-pointer ${
                    state.objective === o.value
                      ? 'border-[var(--sc-accent)] bg-[color-mix(in_srgb,var(--sc-accent)_5%,transparent)]'
                      : 'border-white/10 hover:bg-white/5'
                  }`}
                >
                  <input
                    type="radio"
                    name="objective"
                    checked={state.objective === o.value}
                    onChange={() => patch({ objective: o.value })}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium">{o.label}</div>
                    <div className="text-xs text-white/50">{o.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">Special ad categories</legend>
            <p className="text-xs text-white/40 mt-0.5">Required by Meta for certain industries.</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              {['CREDIT', 'EMPLOYMENT', 'HOUSING', 'SOCIAL_ISSUES'].map((c) => (
                <label key={c} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={state.specialAdCategories.includes(c)}
                    onChange={() =>
                      patch({
                        specialAdCategories: state.specialAdCategories.includes(c)
                          ? state.specialAdCategories.filter((x) => x !== c)
                          : [...state.specialAdCategories, c],
                      })
                    }
                  />
                  {c.replace('_', ' ').toLowerCase()}
                </label>
              ))}
            </div>
          </fieldset>

          <BudgetEditor
            level="campaign"
            currency={currency}
            value={state.campaignBudget}
            onChange={(v) => patch({ campaignBudget: v })}
          />
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <label className="block text-sm">
            <span className="font-medium">Ad set name</span>
            <input
              className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
              value={state.adSetName}
              onChange={(e) => patch({ adSetName: e.target.value })}
              aria-label="Ad set name"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="font-medium">Optimization goal</span>
              <select
                className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
                value={state.optimizationGoal}
                onChange={(e) => patch({ optimizationGoal: e.target.value as AdSetOptimizationGoal })}
              >
                {OPTIMIZATION_GOALS.map((g) => (
                  <option key={g} value={g}>
                    {g.replace(/_/g, ' ').toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium">Billing event</span>
              <select
                className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
                value={state.billingEvent}
                onChange={(e) => patch({ billingEvent: e.target.value as AdSetBillingEvent })}
              >
                <option value="IMPRESSIONS">Impressions</option>
                <option value="LINK_CLICKS">Link clicks</option>
                <option value="THRUPLAY">Thruplay</option>
              </select>
            </label>
          </div>

          <fieldset>
            <legend className="text-sm font-medium">Placements</legend>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              {(['feeds', 'stories', 'reels', 'marketplace'] as const).map((p) => (
                <label key={p} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={state.placements[p]}
                    onChange={() => patch({ placements: { ...state.placements, [p]: !state.placements[p] } })}
                  />
                  {p}
                </label>
              ))}
            </div>
          </fieldset>

          <TargetingEditor orgId={orgId} value={state.targeting} onChange={(t) => patch({ targeting: t })} />

          {!state.campaignBudget.cboEnabled && (
            <BudgetEditor
              level="adset"
              currency={currency}
              value={state.adSetBudget}
              onChange={(v) => patch({ adSetBudget: v })}
            />
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <label className="block text-sm">
            <span className="font-medium">Ad name (internal)</span>
            <input
              className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
              value={state.adName}
              onChange={(e) => patch({ adName: e.target.value })}
              aria-label="Ad name"
            />
          </label>

          <div className="space-y-2">
            <label className="block text-sm font-medium">Creative</label>
            {state.creativeIds.length > 0 ? (
              <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-emerald-300">
                    {state.creativeIds.length} creative{state.creativeIds.length === 1 ? '' : 's'} selected
                  </span>
                  <button
                    type="button"
                    className="text-xs text-white/60 underline"
                    onClick={() => {
                      patch({ creativeIds: [] })
                      setPickerOpen(true)
                    }}
                  >
                    Change
                  </button>
                </div>
                <div className="mt-1 text-xs text-white/40">
                  IDs: {state.creativeIds.join(', ')}
                </div>
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  className="btn-pib-accent text-sm"
                  onClick={() => setPickerOpen(true)}
                >
                  Pick from library
                </button>
                <p className="mt-2 text-xs text-white/40">
                  Or paste an image URL below (Phase 2 fallback - soon-):
                </p>
                <input
                  type="url"
                  className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
                  value={state.inlineImageUrl}
                  onChange={(e) => patch({ inlineImageUrl: e.target.value })}
                  placeholder="https://example.com/ad-image.jpg"
                  aria-label="Inline image URL"
                />
              </div>
            )}
          </div>

          <CreativePicker
            open={pickerOpen}
            orgId={orgId}
            type="image"
            mode={state.format === 'CAROUSEL' ? 'multi' : 'single'}
            onClose={() => setPickerOpen(false)}
            onSelect={(ids) => {
              patch({ creativeIds: ids })
              setPickerOpen(false)
            }}
          />

          <label className="block text-sm">
            <span className="font-medium">Primary text</span>
            <textarea
              className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
              value={state.primaryText}
              onChange={(e) => patch({ primaryText: e.target.value })}
              rows={3}
              aria-label="Primary text"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="font-medium">Headline</span>
              <input
                className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
                value={state.headline}
                onChange={(e) => patch({ headline: e.target.value })}
                aria-label="Headline"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium">Description (optional)</span>
              <input
                className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
                value={state.description}
                onChange={(e) => patch({ description: e.target.value })}
                aria-label="Description"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="font-medium">Call to action</span>
              <select
                className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
                value={state.callToAction}
                onChange={(e) => patch({ callToAction: e.target.value as AdCallToAction })}
              >
                {CTAS.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, ' ').toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium">Destination URL</span>
              <input
                type="url"
                className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
                value={state.destinationUrl}
                onChange={(e) => patch({ destinationUrl: e.target.value })}
                aria-label="Destination URL"
              />
            </label>
          </div>
        </div>
      )}

      <div className="mt-6 flex justify-between gap-2">
        <button
          type="button"
          className="btn-pib-ghost text-sm"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || submitting}
        >
          Back
        </button>
        {step < 2 ? (
          <button
            type="button"
            className="btn-pib-accent text-sm"
            onClick={() => setStep((s) => s + 1)}
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

      <DiffWarningDialog
        open={showWarn}
        warnings={warnings}
        title="Something went wrong"
        proceedLabel="OK"
        cancelLabel="Close"
        onProceed={() => setShowWarn(false)}
        onCancel={() => setShowWarn(false)}
      />
    </div>
  )
}
