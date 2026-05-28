'use client'
export const dynamic = 'force-dynamic'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SequenceForm } from '@/components/crm/SequenceForm'
import type { Sequence } from '@/lib/sequences/types'

export default function EditSequencePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()

  const [sequence, setSequence] = useState<Sequence | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false

    async function loadSequence() {
      setLoading(true)
      setFetchError(null)
      try {
        const res = await fetch(`/api/v1/crm/sequences/${id}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.json()
        const found: Sequence | null = body.data?.sequence ?? body.data ?? body ?? null
        if (!found?.id) throw new Error('Sequence not found.')
        if (!cancelled) setSequence(found)
      } catch (err: unknown) {
        if (!cancelled) setFetchError(err instanceof Error ? err.message : 'Failed to load sequence.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadSequence()
    return () => {
      cancelled = true
    }
  }, [id])

  function handleSave() {
    router.push('/portal/settings/sequences')
  }

  function handleCancel() {
    router.push('/portal/settings/sequences')
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <button
            type="button"
            onClick={handleCancel}
            className="cursor-pointer flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] mb-4 transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">arrow_back</span>
            Sequences
          </button>
          <p className="eyebrow !text-[10px]">Journey builder</p>
          <h1 className="pib-page-title mt-2">Edit sequence</h1>
          <p className="pib-page-sub max-w-2xl">
            Tune the journey content, cadence, and launch state while keeping the CRM follow-up path readable.
          </p>
        </div>
        {sequence && (
          <div className="bento-card !p-4 w-full max-w-sm">
            <p className="text-xs font-medium">{sequence.status === 'active' ? 'Currently active' : sequence.status === 'paused' ? 'Currently paused' : 'Currently draft'}</p>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              {sequence.steps.length} step{sequence.steps.length === 1 ? '' : 's'} configured for this journey.
            </p>
          </div>
        )}
      </div>

      {loading ? (
        <div className="bento-card !p-6">
          <p className="text-sm text-[var(--color-pib-text-muted)]">Loading sequence...</p>
        </div>
      ) : fetchError ? (
        <div className="bento-card !p-6 flex items-start gap-2">
          <span className="material-symbols-outlined text-[16px] text-red-400 mt-0.5">error</span>
          <div>
            <p className="text-sm text-red-400">{fetchError}</p>
            <button
              type="button"
              onClick={handleCancel}
              className="cursor-pointer mt-3 btn-pib-secondary text-sm"
            >
              Back to sequences
            </button>
          </div>
        </div>
      ) : sequence ? (
        <SequenceForm initial={sequence} onSave={handleSave} onCancel={handleCancel} />
      ) : null}
    </div>
  )
}
