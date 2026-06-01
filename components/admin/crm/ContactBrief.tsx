'use client'

import { useState } from 'react'

interface Props {
  contactId: string
  contactName?: string
}

export default function ContactBrief({ contactId, contactName }: Props) {
  const [brief, setBrief] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const contactLabel = contactName?.trim() || 'this contact'

  async function generate() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/ai/contact-brief/${contactId}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed to generate brief')
      setBrief(body.data.brief)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate brief')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            Relationship intelligence
          </p>
          <h3 className="mt-1 text-base font-semibold text-on-surface">
            {brief ? `${contactLabel}'s CRM brief` : `Generate ${contactLabel}'s CRM brief`}
          </h3>
        </div>
        <button
          type="button"
          onClick={generate}
          aria-label={`${brief || error ? 'Retry' : 'Generate'} relationship brief for ${contactLabel}`}
          disabled={loading}
          className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 text-xs disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[15px]" aria-hidden="true">
            {loading ? 'hourglass_top' : brief || error ? 'refresh' : 'psychology'}
          </span>
          {loading ? 'Generating...' : brief || error ? 'Retry brief' : 'Generate brief'}
        </button>
      </div>
      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
        >
          {error}
        </div>
      )}
      {brief ? (
        <div className="rounded-lg border border-outline-variant/70 bg-black/10 px-3 py-3">
          <p className="text-sm leading-relaxed text-on-surface">{brief}</p>
        </div>
      ) : !loading && (
        <div className="rounded-lg border border-dashed border-outline-variant bg-black/10 px-3 py-3">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            Relationship intelligence missing
          </p>
          <p className="mt-2 text-sm leading-6 text-on-surface-variant">
            Create a concise brief from activity, email, deal, and profile context so the next employee has the relationship history before they act.
          </p>
        </div>
      )}
      {loading && (
        <div className="space-y-2">
          <div className="h-3 bg-surface-container-high animate-pulse rounded" />
          <div className="h-3 bg-surface-container-high animate-pulse rounded w-4/5" />
          <div className="h-3 bg-surface-container-high animate-pulse rounded w-3/5" />
        </div>
      )}
    </div>
  )
}
