'use client'
export const dynamic = 'force-dynamic'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { SequenceForm } from '@/components/crm/SequenceForm'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import type { Sequence } from '@/lib/sequences/types'

export default function EditSequencePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const sequencesHref = useMemo(() => scopedPortalPath('/portal/settings/sequences', orgScope), [orgScope])
  const sequenceEndpoint = useCallback(
    (path: string) => scopedApiPath(path, orgScope),
    [orgScope],
  )

  const [sequence, setSequence] = useState<Sequence | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const loadSequence = useCallback(async (cancelled?: () => boolean) => {
    if (!id) return
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch(sequenceEndpoint(`/api/v1/crm/sequences/${id}`))
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`
        throw new Error(message)
      }
      const found: Sequence | null = body.data?.sequence ?? body.data ?? body ?? null
      if (!found?.id) throw new Error('Sequence not found.')
      if (!cancelled?.()) setSequence(found)
    } catch (err: unknown) {
      if (!cancelled?.()) setFetchError(err instanceof Error ? err.message : 'Failed to load sequence.')
    } finally {
      if (!cancelled?.()) setLoading(false)
    }
  }, [id, sequenceEndpoint])

  useEffect(() => {
    if (!id) return
    let cancelled = false

    void loadSequence(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [id, loadSequence])

  function handleSave() {
    router.push(sequencesHref)
  }

  function handleCancel() {
    router.push(sequencesHref)
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
        <section className="bento-card border-amber-400/25 bg-amber-400/10">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-amber-400/25 bg-amber-400/10 text-amber-200">
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">warning</span>
              </span>
              <div>
                <p className="eyebrow !text-[10px] text-amber-200">Source health</p>
                <h2 className="mt-1 font-display text-xl text-[var(--color-pib-text)]">
                  Sequence journey could not load
                </h2>
                <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">{fetchError}</p>
                <p className="mt-3 text-xs leading-5 text-[var(--color-pib-text-muted)]">
                  Journey status, steps, and launch controls stay hidden until the sequence source responds, so teams do not edit from stale or partial follow-up data.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => loadSequence()}
                aria-label="Retry loading sequence journey"
                className="cursor-pointer btn-pib-secondary flex items-center gap-1.5 text-sm"
              >
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">refresh</span>
                Retry
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="cursor-pointer btn-pib-secondary text-sm"
              >
                Back to sequences
              </button>
            </div>
          </div>
        </section>
      ) : sequence ? (
        <SequenceForm initial={sequence} apiScope={orgScope} onSave={handleSave} onCancel={handleCancel} />
      ) : null}
    </div>
  )
}
