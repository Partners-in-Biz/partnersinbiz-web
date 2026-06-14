'use client'
// components/ads/linkedin/audience-builders/EngagementAudienceBuilder.tsx
// LinkedIn Engagement (ENGAGEMENT) audience builder — Phase 3 Batch 3

import { useState } from 'react'

interface Props {
  orgId: string
  orgSlug: string
  onCreated?: (audienceId: string) => void
  onCancel?: () => void
}

type EngagementType = 'VISITORS' | 'FOLLOWERS' | 'VIDEO_VIEWERS'
type State = 'idle' | 'submitting' | 'done' | 'error'

const inputCls =
  'mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:border-[#F5A623]/60'
const labelCls = 'block text-sm font-medium'

const ENGAGEMENT_TYPES: { value: EngagementType; label: string }[] = [
  { value: 'VISITORS', label: 'Page visitors' },
  { value: 'FOLLOWERS', label: 'Company followers' },
  { value: 'VIDEO_VIEWERS', label: 'Video viewers' },
]

export function LinkedinEngagementAudienceBuilder({ orgId, onCreated, onCancel }: Props) {
  const [name, setName] = useState('')
  const [organizationUrn, setOrganizationUrn] = useState('')
  const [engagementType, setEngagementType] = useState<EngagementType>('VISITORS')
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState<string | null>(null)

  function canSubmit() {
    return name.trim().length > 0 && organizationUrn.trim().length > 0
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
          type: 'ENGAGEMENT',
          providerData: {
            linkedin: {
              organizationUrn: organizationUrn.trim(),
              engagementType,
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
    setOrganizationUrn('')
    setEngagementType('VISITORS')
    setState('idle')
    setError(null)
  }

  if (state === 'done') {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
        <p className="font-medium text-emerald-300">Engagement audience created</p>
        <p className="mt-1 text-xs text-white/60">
          LinkedIn will populate this audience based on engagement with the client company page.
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
          placeholder="e.g. Company page visitors"
          disabled={state === 'submitting'}
        />
      </label>

      <label className={labelCls}>
        Organization URN
        <input
          className={inputCls}
          value={organizationUrn}
          onChange={(e) => setOrganizationUrn(e.target.value)}
          aria-label="Organization URN"
          placeholder="urn:li:organization:12345678"
          disabled={state === 'submitting'}
        />
        <span className="text-xs text-white/40 mt-1 block">
          Format: urn:li:organization:&#123;id&#125; — client LinkedIn company page URN
        </span>
      </label>

      <label className={labelCls}>
        Engagement type
        <select
          className={inputCls}
          value={engagementType}
          onChange={(e) => setEngagementType(e.target.value as EngagementType)}
          aria-label="Engagement type"
          disabled={state === 'submitting'}
        >
          {ENGAGEMENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

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
