'use client'
// components/ads/linkedin/audience-builders/WebsiteAudienceBuilder.tsx
// LinkedIn Website (WEBSITE) audience builder — Phase 3 Batch 3

import { useState } from 'react'

interface Props {
  orgId: string
  orgSlug: string
  onCreated?: (audienceId: string) => void
  onCancel?: () => void
}

type MatchType = 'CONTAINS' | 'EQUALS' | 'STARTS_WITH'
type State = 'idle' | 'submitting' | 'done' | 'error'

interface Rule {
  matchType: MatchType
  url: string
}

const inputCls =
  'mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:border-[#F5A623]/60'
const labelCls = 'block text-sm font-medium'

const MATCH_TYPES: { value: MatchType; label: string }[] = [
  { value: 'CONTAINS', label: 'Contains' },
  { value: 'EQUALS', label: 'Equals' },
  { value: 'STARTS_WITH', label: 'Starts with' },
]

export function LinkedinWebsiteAudienceBuilder({ orgId, onCreated, onCancel }: Props) {
  const [name, setName] = useState('')
  const [insightTagId, setInsightTagId] = useState('')
  const [rules, setRules] = useState<Rule[]>([{ matchType: 'CONTAINS', url: '' }])
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState<string | null>(null)

  function updateRule(index: number, patch: Partial<Rule>) {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function addRule() {
    setRules((prev) => [...prev, { matchType: 'CONTAINS', url: '' }])
  }

  function removeRule(index: number) {
    setRules((prev) => prev.filter((_, i) => i !== index))
  }

  function canSubmit() {
    return (
      name.trim().length > 0 &&
      /^\d+$/.test(insightTagId.trim()) &&
      rules.length > 0 &&
      rules.every((r) => r.url.trim().length > 0)
    )
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
          platform: 'linkedin',
          name: name.trim(),
          type: 'WEBSITE',
          providerData: {
            linkedin: {
              insightTagId: insightTagId.trim(),
              websiteRules: rules.map((r) => ({ matchType: r.matchType, url: r.url.trim() })),
            },
          },
        }),
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      const id: string = body.data?.id ?? body.data?.audience?.id ?? ''
      setState('done')
      onCreated?.(id)
    } catch (err) {
      setError((err as Error).message)
      setState('error')
    }
  }

  function reset() {
    setName('')
    setInsightTagId('')
    setRules([{ matchType: 'CONTAINS', url: '' }])
    setState('idle')
    setError(null)
  }

  if (state === 'done') {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
        <p className="font-medium text-emerald-300">Website audience created</p>
        <p className="mt-1 text-xs text-white/60">
          LinkedIn will begin populating this audience as visitors match the admin-defined client rules.
        </p>
        <div className="flex gap-2 mt-3">
          <button type="button" className="btn-pib-ghost text-xs" onClick={reset}>
            Create another
          </button>
          {onCancel && (
            <button type="button" className="btn-pib-ghost text-xs" onClick={onCancel}>
              Done
            </button>
          )}
        </div>
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
          placeholder="e.g. Pricing page visitors"
          disabled={state === 'submitting'}
        />
      </label>

      <label className={labelCls}>
        Insight Tag partner ID
        <input
          className={inputCls}
          value={insightTagId}
          onChange={(e) => setInsightTagId(e.target.value.replace(/\D/g, ''))}
          aria-label="Insight Tag ID"
          placeholder="e.g. 1234567"
          inputMode="numeric"
          disabled={state === 'submitting'}
        />
        <span className="text-xs text-white/40 mt-1 block">Numeric ID from the client LinkedIn Insight Tag</span>
      </label>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className={labelCls}>URL rules (at least 1 required)</span>
          <button
            type="button"
            className="text-xs text-[#F5A623] hover:underline"
            onClick={addRule}
            disabled={state === 'submitting'}
            aria-label="Add rule"
          >
            + Add rule
          </button>
        </div>
        {rules.map((rule, i) => (
          <div key={i} className="flex gap-2 items-start">
            <select
              className="rounded border border-white/10 bg-white/5 px-2 py-2 text-sm focus:outline-none focus:border-[#F5A623]/60"
              value={rule.matchType}
              onChange={(e) => updateRule(i, { matchType: e.target.value as MatchType })}
              aria-label={`Rule ${i + 1} match type`}
              disabled={state === 'submitting'}
            >
              {MATCH_TYPES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <input
              className="flex-1 rounded border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:border-[#F5A623]/60"
              value={rule.url}
              onChange={(e) => updateRule(i, { url: e.target.value })}
              aria-label={`Rule ${i + 1} URL`}
              placeholder="https://yoursite.com/page"
              disabled={state === 'submitting'}
            />
            {rules.length > 1 && (
              <button
                type="button"
                className="text-white/40 hover:text-red-400 px-1 py-2 text-xs"
                onClick={() => removeRule(i)}
                disabled={state === 'submitting'}
                aria-label={`Remove rule ${i + 1}`}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex justify-between">
        {onCancel && (
          <button
            type="button"
            className="btn-pib-ghost text-sm"
            onClick={onCancel}
            disabled={state === 'submitting'}
          >
            Cancel
          </button>
        )}
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
