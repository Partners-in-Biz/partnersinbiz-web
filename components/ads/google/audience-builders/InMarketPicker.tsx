'use client'
// components/ads/google/audience-builders/InMarketPicker.tsx
// Google In-Market audience picker — Sub-3a Phase 5 Batch 3 F

import { useState, useEffect } from 'react'

interface Props {
  orgId: string
  orgSlug: string
}

interface BrowseAudience {
  resourceName: string
  name: string
  description?: string
}

type State = 'loading' | 'idle' | 'submitting' | 'done' | 'error'

const inputCls =
  'mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:border-[#F5A623]/60'
const labelCls = 'block text-sm font-medium'

export function InMarketPicker({ orgId }: Props) {
  const [audiences, setAudiences] = useState<BrowseAudience[]>([])
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<BrowseAudience | null>(null)
  const [audienceName, setAudienceName] = useState('')
  const [state, setState] = useState<State>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/v1/ads/google/audiences/browse?type=IN_MARKET', {
      headers: { 'X-Org-Id': orgId },
    })
      .then((r) => r.json())
      .then((body) => {
        if (!body.success) throw new Error(body.error ?? 'Failed to load')
        setAudiences(body.data?.audiences ?? body.audiences ?? [])
        setState('idle')
      })
      .catch((err) => {
        setError((err as Error).message)
        setState('error')
      })
  }, [orgId])

  const filtered = audiences.filter((a) =>
    a.name.toLowerCase().includes(filter.toLowerCase()),
  )

  function canSubmit() {
    return selected != null && audienceName.trim().length > 0
  }

  async function submit() {
    if (!canSubmit() || !selected) return
    setState('submitting')
    setError(null)
    try {
      const res = await fetch('/api/v1/ads/custom-audiences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId },
        body: JSON.stringify({
          platform: 'google',
          name: audienceName.trim(),
          providerData: {
            google: {
              subtype: 'IN_MARKET',
              audienceResourceName: selected.resourceName,
              categoryName: selected.name,
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
    setFilter('')
    setSelected(null)
    setAudienceName('')
    setState('idle')
    setError(null)
  }

  if (state === 'loading') {
    return <p className="text-sm text-white/40">Loading in-market audiences…</p>
  }

  if (state === 'done') {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
        <p className="font-medium text-emerald-300">In-market audience saved</p>
        <p className="mt-1 text-xs text-white/60">
          This in-market segment is now available for admin-built Google ad sets.
        </p>
        <button type="button" className="btn-pib-ghost mt-3 text-xs" onClick={reset}>
          Add another
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <label className={labelCls}>
        Audience name (how it appears in PiB)
        <input
          className={inputCls}
          value={audienceName}
          onChange={(e) => setAudienceName(e.target.value)}
          aria-label="Audience name"
          placeholder="e.g. Car Buyers — In-Market"
          disabled={state === 'submitting'}
        />
      </label>

      <div>
        <label className={labelCls}>
          Search in-market categories
          <input
            className={inputCls}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Search in-market categories"
            placeholder="Filter by name…"
            disabled={state === 'submitting'}
          />
        </label>

        <div className="mt-2 max-h-64 overflow-y-auto rounded border border-white/10">
          {filtered.length === 0 ? (
            <p className="px-4 py-3 text-sm text-white/40">No categories match the admin filter.</p>
          ) : (
            filtered.map((a) => (
              <label
                key={a.resourceName}
                className={`flex cursor-pointer items-start gap-3 border-b border-white/5 px-4 py-2.5 text-sm last:border-b-0 hover:bg-white/5 ${
                  selected?.resourceName === a.resourceName ? 'bg-[#F5A623]/5' : ''
                }`}
              >
                <input
                  type="radio"
                  name="inmarket-audience"
                  value={a.resourceName}
                  checked={selected?.resourceName === a.resourceName}
                  onChange={() => setSelected(a)}
                  aria-label={a.name}
                  disabled={state === 'submitting'}
                  className="mt-0.5 shrink-0"
                />
                <div>
                  <div className="font-medium">{a.name}</div>
                  {a.description && (
                    <div className="text-xs text-white/40">{a.description}</div>
                  )}
                </div>
              </label>
            ))
          )}
        </div>
        {selected && (
          <p className="mt-1 text-xs text-[#F5A623]">Selected: {selected.name}</p>
        )}
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
          {state === 'submitting' ? 'Saving…' : 'Save audience'}
        </button>
      </div>
    </div>
  )
}
