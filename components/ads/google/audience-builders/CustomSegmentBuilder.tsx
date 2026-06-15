'use client'
// components/ads/google/audience-builders/CustomSegmentBuilder.tsx
// Google Custom Segment audience builder — Sub-3a Phase 5 Batch 3 F

import { useState } from 'react'

interface Props {
  orgId: string
  orgSlug: string
}

type SegmentType = 'KEYWORD' | 'URL' | 'APP'
type State = 'idle' | 'submitting' | 'done' | 'error'

const inputCls =
  'mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:border-[#F5A623]/60'
const labelCls = 'block text-sm font-medium'

const SEGMENT_TYPES: { value: SegmentType; label: string; placeholder: string }[] = [
  { value: 'KEYWORD', label: 'Keywords', placeholder: 'running shoes\nmarathon training' },
  { value: 'URL', label: 'URLs', placeholder: 'https://competitor.com\nhttps://another.com' },
  { value: 'APP', label: 'App IDs', placeholder: 'com.example.app\ncom.example.other' },
]

export function CustomSegmentBuilder({ orgId }: Props) {
  const [name, setName] = useState('')
  const [segmentType, setSegmentType] = useState<SegmentType>('KEYWORD')
  const [valuesRaw, setValuesRaw] = useState('')
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState<string | null>(null)

  const trimmedValues = valuesRaw
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean)

  function canSubmit() {
    return name.trim().length > 0 && trimmedValues.length > 0
  }

  async function submit() {
    if (!canSubmit()) return
    setState('submitting')
    setError(null)
    try {
      const res = await fetch('/api/v1/ads/custom-audiences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId },
        body: JSON.stringify({
          platform: 'google',
          name: name.trim(),
          providerData: {
            google: {
              subtype: 'CUSTOM_SEGMENT',
              segmentType,
              values: trimmedValues,
            },
          },
        }),
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      setState('done')
    } catch (err) {
      setError((err as Error).message)
      setState('error')
    }
  }

  function reset() {
    setName('')
    setSegmentType('KEYWORD')
    setValuesRaw('')
    setState('idle')
    setError(null)
  }

  const activeMeta = SEGMENT_TYPES.find((t) => t.value === segmentType)!

  if (state === 'done') {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
        <p className="font-medium text-emerald-300">Custom segment audience created</p>
        <p className="mt-1 text-xs text-white/60">
          Google Ads will target users based on the client {segmentType.toLowerCase()} signals.
        </p>
        <button type="button" className="btn-pib-ghost mt-3 text-xs" onClick={reset}>
          Create another
        </button>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm">
        <p className="font-medium text-red-300">Failed to create audience</p>
        <p className="mt-1 text-xs text-white/60">{error}</p>
        <button type="button" className="btn-pib-ghost mt-3 text-xs" onClick={reset}>
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <label className={labelCls}>
        Audience name
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Audience name"
          placeholder="e.g. Competitor visitors"
          disabled={state === 'submitting'}
        />
      </label>

      <fieldset>
        <legend className={labelCls}>Segment type</legend>
        <div className="mt-2 flex gap-3">
          {SEGMENT_TYPES.map((t) => (
            <label
              key={t.value}
              className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm transition-colors ${
                segmentType === t.value
                  ? 'border-[#F5A623] text-[#F5A623]'
                  : 'border-white/10 text-white/60 hover:bg-white/5'
              }`}
            >
              <input
                type="radio"
                name="segment-type"
                value={t.value}
                checked={segmentType === t.value}
                onChange={() => setSegmentType(t.value)}
                aria-label={t.label}
                disabled={state === 'submitting'}
              />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className={labelCls}>
        {activeMeta.label} (one per line)
        <textarea
          className={`${inputCls} min-h-[120px] resize-y font-mono`}
          value={valuesRaw}
          onChange={(e) => setValuesRaw(e.target.value)}
          aria-label="Values"
          placeholder={activeMeta.placeholder}
          disabled={state === 'submitting'}
        />
      </label>

      {trimmedValues.length > 0 && (
        <p className="text-xs text-white/40">{trimmedValues.length} value(s) ready to submit</p>
      )}

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          className="btn-pib-accent text-sm"
          onClick={submit}
          disabled={!canSubmit() || state === 'submitting'}
        >
          {state === 'submitting' ? 'Creating…' : 'Create audience'}
        </button>
      </div>
    </div>
  )
}
