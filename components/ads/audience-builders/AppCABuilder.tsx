'use client'
import { useState, useEffect } from 'react'
import type { AdCustomAudience } from '@/lib/ads/types'

interface Props {
  orgId: string
  onComplete?: (ca: AdCustomAudience) => void
  onCancel?: () => void
}

interface PiBProperty {
  id: string
  name: string
}

const RETENTION_OPTIONS = [30, 60, 90, 180]

export function AppCABuilder({ orgId, onComplete, onCancel }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [propertyId, setPropertyId] = useState('')
  const [event, setEvent] = useState('')
  const [retentionDays, setRetentionDays] = useState(30)
  const [properties, setProperties] = useState<PiBProperty[]>([])
  const [loadingProperties, setLoadingProperties] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/v1/properties', {
          headers: { 'X-Org-Id': orgId },
        })
        const body = await res.json()
        if (!cancelled && body.success) {
          setProperties((body.data as PiBProperty[]) ?? [])
        }
      } catch {
        // silently ignore
      } finally {
        if (!cancelled) setLoadingProperties(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [orgId])

  function canSubmit(): boolean {
    return name.trim() !== '' && propertyId !== '' && event.trim() !== ''
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
            type: 'APP',
            name,
            description,
            status: 'BUILDING',
            source: {
              kind: 'APP',
              propertyId,
              event: event.trim(),
              retentionDays,
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
        <span className="font-medium">Property</span>
        <select
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          aria-label="Property"
          disabled={submitting || loadingProperties}
        >
          <option value="">
            {loadingProperties ? 'Loading…' : properties.length === 0 ? 'No properties' : ' -  Select - '}
          </option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="font-medium">Event name</span>
        <input
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          value={event}
          onChange={(e) => setEvent(e.target.value)}
          placeholder="Purchase"
          aria-label="Event name"
          disabled={submitting}
        />
        <p className="mt-1 text-xs text-white/40">
          Event as recorded in PiB analytics (e.g. Purchase, CompleteRegistration).
        </p>
      </label>

      <label className="block text-sm">
        <span className="font-medium">Retention</span>
        <select
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          value={retentionDays}
          onChange={(e) => setRetentionDays(Number(e.target.value))}
          aria-label="Retention"
          disabled={submitting}
        >
          {RETENTION_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
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
