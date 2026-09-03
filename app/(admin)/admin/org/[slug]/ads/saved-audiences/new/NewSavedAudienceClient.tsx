'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TargetingEditor } from '@/components/ads/TargetingEditor'
import type { AdTargeting } from '@/lib/ads/types'

interface Props { orgId: string; orgSlug: string }

const INITIAL_TARGETING: AdTargeting = {
  geo: { countries: ['US'] },
  demographics: { ageMin: 18, ageMax: 65 },
  customAudiences: { include: [], exclude: [] },
}

export function NewSavedAudienceClient({ orgId, orgSlug }: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [targeting, setTargeting] = useState<AdTargeting>(INITIAL_TARGETING)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!name.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/ads/saved-audiences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId },
        body: JSON.stringify({
          input: { name, description, targeting },
        }),
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      router.push(`/admin/org/${orgSlug}/ads/saved-audiences?created=1`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="space-y-8 max-w-2xl">
      <header>
        <p className="eyebrow">Ads · Audiences</p>
        <h1 className="pib-page-title mt-2">New saved audience</h1>
        <p className="pib-page-sub">Save targeting once, reuse on any ad set.</p>
      </header>

      <label className="block text-sm space-y-1.5">
        <span className="pib-label">Name</span>
        <input
          className="pib-input w-full"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. US adults 25-54 high intent"
          aria-label="Name"
          disabled={submitting}
        />
      </label>

      <label className="block text-sm space-y-1.5">
        <span className="pib-label">Description (optional)</span>
        <input
          className="pib-input w-full"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Description"
          disabled={submitting}
        />
      </label>

      <div className="pib-card space-y-3">
        <h2 className="pib-label">Targeting</h2>
        <TargetingEditor orgId={orgId} value={targeting} onChange={setTargeting} />
      </div>

      {error && (
        <div className="rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error-container)] p-3 text-sm text-[var(--color-error)]">{error}</div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn-pib-ghost text-sm"
          onClick={() => router.push(`/admin/org/${orgSlug}/ads/saved-audiences`)}
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-pib-primary text-sm"
          onClick={submit}
          disabled={!name.trim() || submitting}
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  )
}
