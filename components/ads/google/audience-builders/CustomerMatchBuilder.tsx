'use client'
// components/ads/google/audience-builders/CustomerMatchBuilder.tsx
// Google Customer Match audience builder — Sub-3a Phase 5 Batch 3 F

import { useState } from 'react'

interface Props {
  orgId: string
  orgSlug: string
}

type State = 'idle' | 'submitting' | 'done' | 'error'

const inputCls =
  'mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:border-[#F5A623]/60'
const labelCls = 'block text-sm font-medium'

export function CustomerMatchBuilder({ orgId }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [members, setMembers] = useState('')
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState<string | null>(null)

  function canSubmit() {
    return name.trim().length > 0 && members.trim().length > 0
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
          description: description.trim() || undefined,
          providerData: {
            google: {
              subtype: 'CUSTOMER_MATCH',
              uploadKeyType: 'CONTACT_INFO',
              members: members
                .split(/[\n,]+/)
                .map((v) => v.trim())
                .filter(Boolean),
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
    setDescription('')
    setMembers('')
    setState('idle')
    setError(null)
  }

  if (state === 'done') {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
        <p className="font-medium text-emerald-300">Customer Match audience created</p>
        <p className="mt-1 text-xs text-white/60">
          Google is processing the approved list. Members upload will reflect in the audience once matched.
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
          placeholder="e.g. Existing customers"
          disabled={state === 'submitting'}
        />
      </label>

      <label className={labelCls}>
        Description (optional)
        <input
          className={inputCls}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Description"
          placeholder="Optional description"
          disabled={state === 'submitting'}
        />
      </label>

      <label className={labelCls}>
        Email addresses (comma or line-separated)
        <textarea
          className={`${inputCls} min-h-[120px] resize-y font-mono`}
          value={members}
          onChange={(e) => setMembers(e.target.value)}
          aria-label="Email addresses"
          placeholder={"user@example.com\nuser2@example.com"}
          disabled={state === 'submitting'}
        />
      </label>

      <p className="text-xs text-white/40">
        Emails are hashed server-side (SHA-256) before upload to Google. Raw PII is never persisted.
      </p>

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
