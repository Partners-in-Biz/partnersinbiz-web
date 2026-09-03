'use client'
import { useState, useEffect } from 'react'
import type { AdCustomAudience } from '@/lib/ads/types'

interface Props {
  orgId: string
  onComplete?: (ca: AdCustomAudience) => void
  onCancel?: () => void
}

export function LookalikeBuilder({ orgId, onComplete, onCancel }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sourceAudienceId, setSourceAudienceId] = useState('')
  const [percent, setPercent] = useState(1)
  const [country, setCountry] = useState('')
  const [sources, setSources] = useState<AdCustomAudience[]>([])
  const [loadingSources, setLoadingSources] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/v1/ads/custom-audiences?status=READY', {
          headers: { 'X-Org-Id': orgId },
        })
        const body = await res.json()
        if (!cancelled && body.success) {
          setSources((body.data as AdCustomAudience[]) ?? [])
        }
      } catch {
        // silently ignore - user can still see empty dropdown
      } finally {
        if (!cancelled) setLoadingSources(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [orgId])

  function canSubmit(): boolean {
    return name.trim() !== '' && sourceAudienceId !== '' && country.trim() !== ''
  }

  async function submit() {
    if (!canSubmit()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/ads/custom-audiences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId },
        body: JSON.stringify({
          input: {
            type: 'LOOKALIKE',
            name,
            description,
            status: 'BUILDING',
            source: {
              kind: 'LOOKALIKE',
              sourceAudienceId,
              percent,
              country: country.trim().toUpperCase(),
            },
          },
        }),
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      onComplete?.(body.data as AdCustomAudience)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <label className="block text-sm">
        <span className="font-medium">Audience name</span>
        <input
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Audience name"
          disabled={submitting}
        />
      </label>

      <label className="block text-sm">
        <span className="font-medium">Description (optional)</span>
        <input
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Description"
          disabled={submitting}
        />
      </label>

      <label className="block text-sm">
        <span className="font-medium">Source audience</span>
        <select
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          value={sourceAudienceId}
          onChange={(e) => setSourceAudienceId(e.target.value)}
          aria-label="Source audience"
          disabled={submitting || loadingSources}
        >
          <option value="">
            {loadingSources ? 'Loading…' : sources.length === 0 ? 'No READY audiences' : ' -  Select - '}
          </option>
          {sources.map((ca) => (
            <option key={ca.id} value={ca.id}>
              {ca.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-white/40">
          Only READY custom audiences can seed a lookalike.
        </p>
      </label>

      <label className="block text-sm">
        <span className="font-medium">Similarity - {percent}%</span>
        <input
          type="range"
          className="mt-1 w-full accent-[var(--sc-accent)]"
          min={1}
          max={10}
          step={1}
          value={percent}
          onChange={(e) => setPercent(Number(e.target.value))}
          aria-label="Similarity percent"
          disabled={submitting}
        />
        <div className="flex justify-between text-xs text-white/40">
          <span>1% most similar</span>
          <span>10% broadest</span>
        </div>
      </label>

      <label className="block text-sm">
        <span className="font-medium">Country</span>
        <input
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          placeholder="ZA"
          aria-label="Country"
          disabled={submitting}
        />
        <p className="mt-1 text-xs text-white/40">ISO 3166-1 alpha-2 code (e.g. ZA, US, GB).</p>
      </label>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            className="btn-pib-ghost text-sm"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          className="btn-pib-accent text-sm"
          onClick={submit}
          disabled={!canSubmit() || submitting}
        >
          {submitting ? 'Creating…' : 'Create audience'}
        </button>
      </div>
    </div>
  )
}
