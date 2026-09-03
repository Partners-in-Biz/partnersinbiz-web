'use client'
// components/ads/google/audience-builders/RemarketingBuilder.tsx
// Google Remarketing (website visitor) audience builder - Sub-3a Phase 5 Batch 3 F

import { useState } from 'react'

interface Props {
  orgId: string
  orgSlug: string
}

type RuleKind = 'URL_CONTAINS' | 'URL_EQUALS' | 'URL_STARTS_WITH' | 'APP_ID'

type State = 'idle' | 'submitting' | 'done' | 'error'

const inputCls =
  'mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:border-[color-mix(in_srgb,var(--sc-accent)_60%,transparent)]'
const labelCls = 'block text-sm font-medium'

const RULE_KINDS: { value: RuleKind; label: string }[] = [
  { value: 'URL_CONTAINS', label: 'URL contains' },
  { value: 'URL_EQUALS', label: 'URL equals' },
  { value: 'URL_STARTS_WITH', label: 'URL starts with' },
  { value: 'APP_ID', label: 'App ID' },
]

export function RemarketingBuilder({ orgId }: Props) {
  const [name, setName] = useState('')
  const [membershipLifeSpanDays, setMembershipLifeSpanDays] = useState(30)
  const [ruleKind, setRuleKind] = useState<RuleKind>('URL_CONTAINS')
  const [ruleValue, setRuleValue] = useState('')
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState<string | null>(null)

  function canSubmit() {
    return (
      name.trim().length > 0 &&
      ruleValue.trim().length > 0 &&
      membershipLifeSpanDays >= 1 &&
      membershipLifeSpanDays <= 540
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
          platform: 'google',
          name: name.trim(),
          providerData: {
            google: {
              subtype: 'REMARKETING',
              membershipLifeSpanDays,
              rule: {
                kind: ruleKind,
                value: ruleValue.trim(),
              },
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
    setMembershipLifeSpanDays(30)
    setRuleKind('URL_CONTAINS')
    setRuleValue('')
    setState('idle')
    setError(null)
  }

  if (state === 'done') {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
        <p className="font-medium text-emerald-300">Remarketing audience created</p>
        <p className="mt-1 text-xs text-white/60">
          Google will start building this audience as users match the rule.
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
          placeholder="e.g. Pricing page visitors"
          disabled={state === 'submitting'}
        />
      </label>

      <label className={labelCls}>
        Membership lifespan (days, 1–540)
        <input
          type="number"
          className={inputCls}
          value={membershipLifeSpanDays}
          onChange={(e) =>
            setMembershipLifeSpanDays(Math.max(1, Math.min(540, parseInt(e.target.value) || 1)))
          }
          min={1}
          max={540}
          aria-label="Membership lifespan"
          disabled={state === 'submitting'}
        />
      </label>

      <div className="space-y-2">
        <span className={labelCls}>URL / App rule</span>
        <div className="flex gap-2">
          <select
            className="rounded border border-white/10 bg-white/5 px-2 py-2 text-sm focus:outline-none focus:border-[color-mix(in_srgb,var(--sc-accent)_60%,transparent)]"
            value={ruleKind}
            onChange={(e) => setRuleKind(e.target.value as RuleKind)}
            aria-label="Rule kind"
            disabled={state === 'submitting'}
          >
            {RULE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <input
            className="flex-1 rounded border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:border-[color-mix(in_srgb,var(--sc-accent)_60%,transparent)]"
            value={ruleValue}
            onChange={(e) => setRuleValue(e.target.value)}
            aria-label="Rule value"
            placeholder="/pricing"
            disabled={state === 'submitting'}
          />
        </div>
      </div>

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
