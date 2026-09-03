'use client'

import { Icon } from '@/components/studio'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function QuickEmailCampaignCreator({ orgId, slug }: { orgId: string; slug: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function createCampaign() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, name: trimmed }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Failed to create campaign')
        return
      }
      const newId = body.data?.id
      if (newId) router.push(`/admin/org/${slug}/campaigns/${newId}`)
    } catch {
      setError('Failed to create campaign')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="pib-card p-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="eyebrow">Admin creation</p>
          <h2 className="font-headline text-xl font-medium mt-2">Create an email campaign draft</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-1">
            Clients request campaigns; admins create the operational campaign records.
          </p>
        </div>
        <button type="button" onClick={() => setOpen((value) => !value)} className="pib-btn-primary">
          <Icon name={open ? 'close' : 'add'} className="text-[18px]" />
          Email campaign
        </button>
      </div>
      {open && (
        <div className="mt-5 pt-5 border-t border-[var(--color-pib-line)]">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && createCampaign()}
              placeholder="Campaign name"
              aria-label="Campaign name"
              className="pib-input flex-1"
              autoFocus
            />
            <button type="button" onClick={createCampaign} disabled={submitting || !name.trim()} className="pib-btn-primary disabled:opacity-50">
              {submitting ? 'Creating...' : 'Create draft'}
            </button>
          </div>
          {error && <p className="text-sm text-red-300 mt-3">{error}</p>}
        </div>
      )}
    </section>
  )
}
