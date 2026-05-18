'use client'

import { useState } from 'react'
import type {
  AdExperiment,
  ExperimentLevel,
  ExperimentMetric,
} from '@/lib/ads/experiments/types'
import type { AdPlatform } from '@/lib/ads/types'

const VARIANT_IDS = ['a', 'b', 'c', 'd'] as const
type VariantId = (typeof VARIANT_IDS)[number]

interface VariantDraft {
  id: VariantId
  name: string
  trafficPercent: number
  overridesJson: string
}

interface Props {
  orgSlug: string
  /** When provided, runs PATCH. Otherwise POST. */
  experimentId?: string
  /** Existing experiment data for edit mode. */
  initial?: Partial<AdExperiment>
  onSaved: (experiment: AdExperiment) => void
}

const PLATFORMS: { value: AdPlatform; label: string }[] = [
  { value: 'meta', label: 'Meta' },
  { value: 'google', label: 'Google' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'tiktok', label: 'TikTok' },
]

const METRICS: { value: ExperimentMetric; label: string }[] = [
  { value: 'cpc', label: 'Cost per Click (CPC)' },
  { value: 'cpa', label: 'Cost per Acquisition (CPA)' },
  { value: 'conv_rate', label: 'Conversion Rate' },
  { value: 'ctr', label: 'Click-Through Rate (CTR)' },
  { value: 'roas', label: 'Return on Ad Spend (ROAS)' },
]

function defaultVariant(id: VariantId, percent: number): VariantDraft {
  return { id, name: `Variant ${id.toUpperCase()}`, trafficPercent: percent, overridesJson: '{}' }
}

export function ExperimentEditor({ orgSlug, experimentId, initial, onSaved }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [level, setLevel] = useState<ExperimentLevel>(initial?.level ?? 'adset')
  const [platform, setPlatform] = useState<AdPlatform>(initial?.platform ?? 'meta')
  const [parentEntityId, setParentEntityId] = useState(initial?.parentEntityId ?? '')
  const [sourceEntityId, setSourceEntityId] = useState(initial?.sourceEntityId ?? '')
  const [successMetric, setSuccessMetric] = useState<ExperimentMetric>(initial?.successMetric ?? 'ctr')
  const [minDays, setMinDays] = useState(initial?.minDays ?? 7)
  const [significanceThreshold, setSignificanceThreshold] = useState(
    initial?.significanceThreshold ?? 0.05,
  )
  const [autoWinner, setAutoWinner] = useState(initial?.autoWinner ?? false)

  const [variants, setVariants] = useState<VariantDraft[]>(() => {
    if (initial?.variants && initial.variants.length >= 2) {
      return initial.variants.map((v) => ({
        id: v.id as VariantId,
        name: v.name,
        trafficPercent: v.trafficPercent,
        overridesJson: v.overrides ? JSON.stringify(v.overrides, null, 2) : '{}',
      }))
    }
    return [defaultVariant('a', 50), defaultVariant('b', 50)]
  })

  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  function addVariant() {
    if (variants.length >= 4) return
    const nextId = VARIANT_IDS[variants.length]
    setVariants((prev) => [...prev, defaultVariant(nextId, 0)])
  }

  function removeVariant(idx: number) {
    if (variants.length <= 2) return
    setVariants((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateVariant(idx: number, patch: Partial<VariantDraft>) {
    setVariants((prev) => prev.map((v, i) => (i === idx ? { ...v, ...patch } : v)))
  }

  function validate(): string[] {
    const errs: string[] = []
    if (!name.trim()) errs.push('Name is required.')
    if (variants.length < 2) errs.push('At least 2 variants required.')

    const ids = variants.map((v) => v.id)
    if (new Set(ids).size !== ids.length) errs.push('Variant IDs must be unique.')

    const totalPercent = variants.reduce((s, v) => s + v.trafficPercent, 0)
    if (Math.round(totalPercent) !== 100)
      errs.push(`Traffic percents must sum to 100 (currently ${totalPercent}).`)

    if (!parentEntityId.trim()) errs.push('Parent entity ID is required.')
    if (!sourceEntityId.trim()) errs.push('Source entity ID is required.')

    for (const v of variants) {
      try {
        JSON.parse(v.overridesJson)
      } catch {
        errs.push(`Variant ${v.id.toUpperCase()} overrides is not valid JSON.`)
      }
    }

    return errs
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (errs.length > 0) {
      setErrors(errs)
      return
    }
    setErrors([])
    setSaving(true)

    try {
      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        level,
        platform,
        parentEntityId: parentEntityId.trim(),
        sourceEntityId: sourceEntityId.trim(),
        variants: variants.map((v) => ({
          id: v.id,
          name: v.name,
          trafficPercent: v.trafficPercent,
          overrides: JSON.parse(v.overridesJson),
        })),
        successMetric,
        minDays,
        significanceThreshold,
        autoWinner,
      }

      const url = experimentId
        ? `/api/v1/ads/experiments/${experimentId}`
        : `/api/v1/ads/experiments`
      const method = experimentId ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error ?? `HTTP ${res.status}`)
      }

      const result = await res.json()
      onSaved(result.data ?? result)
    } catch (err: unknown) {
      setErrors([(err as Error).message ?? 'Unknown error'])
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {errors.length > 0 && (
        <ul className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400 space-y-1">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      {/* Name */}
      <label className="block text-sm">
        <span className="font-medium">Name *</span>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. CTA button A/B test"
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
        />
      </label>

      {/* Description */}
      <label className="block text-sm">
        <span className="font-medium">Description</span>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
        />
      </label>

      {/* Level */}
      <fieldset>
        <legend className="text-sm font-medium">Level *</legend>
        <div className="mt-2 flex gap-4 text-sm">
          {(['adset', 'ad'] as ExperimentLevel[]).map((l) => (
            <label key={l} className="flex items-center gap-2">
              <input
                type="radio"
                name="level"
                value={l}
                checked={level === l}
                onChange={() => setLevel(l)}
              />
              {l === 'adset' ? 'Ad Set' : 'Ad'}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Platform */}
      <label className="block text-sm">
        <span className="font-medium">Platform *</span>
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as AdPlatform)}
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
        >
          {PLATFORMS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {/* Parent entity id */}
      <label className="block text-sm">
        <span className="font-medium">
          {level === 'adset' ? 'Campaign ID' : 'Ad Set ID'} (parent entity) *
        </span>
        <input
          type="text"
          required
          value={parentEntityId}
          onChange={(e) => setParentEntityId(e.target.value)}
          placeholder={level === 'adset' ? 'cmp_xxx' : 'adset_xxx'}
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm font-mono"
        />
      </label>

      {/* Source entity id */}
      <label className="block text-sm">
        <span className="font-medium">Source entity ID (canonical doc to duplicate) *</span>
        <input
          type="text"
          required
          value={sourceEntityId}
          onChange={(e) => setSourceEntityId(e.target.value)}
          placeholder={level === 'adset' ? 'adset_xxx' : 'ad_xxx'}
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm font-mono"
        />
      </label>

      {/* Variants */}
      <fieldset>
        <legend className="text-sm font-medium">
          Variants ({variants.length}/4) — must sum to 100%
        </legend>
        <div className="mt-3 space-y-4">
          {variants.map((v, idx) => (
            <div
              key={v.id}
              className="rounded-lg border border-white/10 bg-white/3 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase text-[#F5A623]">{v.id}</span>
                {variants.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeVariant(idx)}
                    className="text-xs text-white/30 hover:text-red-400"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-white/60">Name</span>
                  <input
                    type="text"
                    value={v.name}
                    onChange={(e) => updateVariant(idx, { name: e.target.value })}
                    className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-1.5 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-white/60">Traffic %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={v.trafficPercent}
                    onChange={(e) =>
                      updateVariant(idx, { trafficPercent: Number(e.target.value) })
                    }
                    className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-1.5 text-sm"
                  />
                </label>
              </div>
              <label className="block text-sm">
                <span className="text-white/60">Overrides (JSON)</span>
                <textarea
                  rows={2}
                  value={v.overridesJson}
                  onChange={(e) => updateVariant(idx, { overridesJson: e.target.value })}
                  className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-mono"
                />
              </label>
            </div>
          ))}
        </div>
        {variants.length < 4 && (
          <button
            type="button"
            onClick={addVariant}
            className="mt-3 text-sm text-[#F5A623]/80 hover:text-[#F5A623]"
            aria-label="Add variant"
          >
            + Add variant
          </button>
        )}
      </fieldset>

      {/* Success metric */}
      <fieldset>
        <legend className="text-sm font-medium">Success metric *</legend>
        <div className="mt-2 space-y-1 text-sm">
          {METRICS.map((m) => (
            <label key={m.value} className="flex items-center gap-2">
              <input
                type="radio"
                name="successMetric"
                value={m.value}
                checked={successMetric === m.value}
                onChange={() => setSuccessMetric(m.value)}
              />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Min days */}
      <label className="block text-sm">
        <span className="font-medium">Minimum days to run</span>
        <input
          type="number"
          min={1}
          value={minDays}
          onChange={(e) => setMinDays(Number(e.target.value))}
          className="mt-1 w-32 rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
        />
      </label>

      {/* Significance threshold */}
      <label className="block text-sm">
        <span className="font-medium">Significance threshold (p-value)</span>
        <input
          type="number"
          min={0.01}
          max={0.2}
          step={0.01}
          value={significanceThreshold}
          onChange={(e) => setSignificanceThreshold(Number(e.target.value))}
          className="mt-1 w-32 rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
        />
      </label>

      {/* Auto-declare winner */}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={autoWinner}
          onChange={(e) => setAutoWinner(e.target.checked)}
        />
        <span className="font-medium">Auto-declare winner when significance is reached</span>
      </label>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="btn-pib-accent text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : experimentId ? 'Save changes' : 'Create experiment'}
        </button>
        <a
          href={`/admin/org/${orgSlug}/ads/experiments`}
          className="rounded border border-white/10 px-4 py-2 text-sm text-white/60 hover:text-white"
        >
          Cancel
        </a>
      </div>
    </form>
  )
}
