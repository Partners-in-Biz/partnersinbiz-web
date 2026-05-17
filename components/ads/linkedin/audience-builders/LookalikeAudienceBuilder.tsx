'use client'
// components/ads/linkedin/audience-builders/LookalikeAudienceBuilder.tsx
// LinkedIn Lookalike (LOOKALIKE) audience builder — Phase 3 Batch 3

import { useState, useEffect } from 'react'

interface Props {
  orgId: string
  orgSlug: string
  onCreated?: (audienceId: string) => void
  onCancel?: () => void
}

type State = 'idle' | 'submitting' | 'done' | 'error'

interface SourceAudience {
  id: string
  name: string
  providerData?: { linkedin?: { segmentUrn?: string } }
}

const inputCls =
  'mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:border-[#F5A623]/60'
const labelCls = 'block text-sm font-medium'

export function LinkedinLookalikeAudienceBuilder({ orgId, onCreated, onCancel }: Props) {
  const [name, setName] = useState('')
  const [sourceSegmentUrn, setSourceSegmentUrn] = useState('')
  const [sources, setSources] = useState<SourceAudience[]>([])
  const [loadingSources, setLoadingSources] = useState(false)
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadSources() {
      setLoadingSources(true)
      try {
        const res = await fetch(
          `/api/v1/ads/custom-audiences?platform=linkedin&status=READY`,
          { headers: { 'X-Org-Id': orgId } }
        )
        const body = await res.json()
        if (body.success) {
          setSources(body.data ?? [])
        }
      } catch {
        // silently ignore — user can type URN manually
      } finally {
        setLoadingSources(false)
      }
    }
    loadSources()
  }, [orgId])

  function canSubmit() {
    return name.trim().length > 0 && sourceSegmentUrn.trim().length > 0
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
          type: 'LOOKALIKE',
          providerData: {
            linkedin: {
              sourceSegmentUrn: sourceSegmentUrn.trim(),
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
    setSourceSegmentUrn('')
    setState('idle')
    setError(null)
  }

  if (state === 'done') {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
        <p className="font-medium text-emerald-300">Lookalike audience created</p>
        <p className="mt-1 text-xs text-white/60">
          LinkedIn will build a lookalike audience from your source segment.
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
          placeholder="e.g. Lookalike — Newsletter subscribers"
          disabled={state === 'submitting'}
        />
      </label>

      <div>
        <label className={labelCls}>
          Source segment
          {loadingSources ? (
            <span className="ml-2 text-xs text-white/40">Loading audiences…</span>
          ) : sources.length > 0 ? (
            <select
              className={inputCls}
              value={sourceSegmentUrn}
              onChange={(e) => setSourceSegmentUrn(e.target.value)}
              aria-label="Source segment URN"
              disabled={state === 'submitting'}
            >
              <option value="">Select a READY audience…</option>
              {sources.map((s) => {
                const urn = s.providerData?.linkedin?.segmentUrn ?? s.id
                const shortUrn = urn.length > 40 ? `…${urn.slice(-30)}` : urn
                return (
                  <option key={s.id} value={urn}>
                    {s.name} ({shortUrn})
                  </option>
                )
              })}
            </select>
          ) : (
            <input
              className={inputCls}
              value={sourceSegmentUrn}
              onChange={(e) => setSourceSegmentUrn(e.target.value)}
              aria-label="Source segment URN"
              placeholder="urn:li:sponsoredAudienceSegment:123456"
              disabled={state === 'submitting'}
            />
          )}
        </label>
        <span className="text-xs text-white/40 mt-1 block">
          Only READY audiences are shown. If none are available yet, enter the segment URN manually.
        </span>
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
