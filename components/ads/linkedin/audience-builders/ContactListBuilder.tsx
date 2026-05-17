'use client'
// components/ads/linkedin/audience-builders/ContactListBuilder.tsx
// LinkedIn Customer List (CUSTOMER_LIST) audience builder — Phase 3 Batch 3

import { useState } from 'react'

interface Props {
  orgId: string
  orgSlug: string
  onCreated?: (audienceId: string) => void
  onCancel?: () => void
}

type State = 'idle' | 'submitting' | 'done' | 'error'

const inputCls =
  'mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:border-[#F5A623]/60'
const labelCls = 'block text-sm font-medium'

export function LinkedinContactListBuilder({ orgId, onCreated, onCancel }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState<string | null>(null)
  const [audienceId, setAudienceId] = useState<string | null>(null)

  function canSubmit() {
    return name.trim().length > 0
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
          type: 'CUSTOMER_LIST',
          description: description.trim() || undefined,
        }),
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      const id: string = body.data?.id ?? body.data?.audience?.id ?? ''
      setAudienceId(id)
      setState('done')
      onCreated?.(id)
    } catch (err) {
      setError((err as Error).message)
      setState('error')
    }
  }

  function reset() {
    setName('')
    setDescription('')
    setState('idle')
    setError(null)
    setAudienceId(null)
  }

  if (state === 'done') {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm space-y-2">
        <p className="font-medium text-emerald-300">Contact List audience created</p>
        {audienceId && (
          <p className="text-xs text-white/60">
            Audience ID: <span className="font-mono">{audienceId}</span>
          </p>
        )}
        <p className="text-xs text-white/60">
          Upload your CSV contact list via the audience detail page to populate this audience.
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
          placeholder="e.g. Newsletter subscribers"
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

      <div className="rounded border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-blue-300">
        After creating the audience, upload your CSV contact list (emails or phone hashes) from the
        audience detail page.
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
