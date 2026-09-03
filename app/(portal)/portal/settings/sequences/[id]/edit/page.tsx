'use client'
export const dynamic = 'force-dynamic'

import { Button, Icon, Notice, Panel, Skeleton, Title } from '@/components/studio'
import { PageHeader } from '@/components/ui/AppFoundation'

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
    <div className="max-w-6xl space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={handleCancel} className="mb-4">
            <Icon name="arrow_back" />
            Sequences
          </Button>
          <PageHeader
            title="Edit sequence."
            description="Tune the journey content, cadence, and launch state while keeping the CRM follow-up path readable."
          />
        </div>
        {sequence && (
          <Panel flat className="w-full max-w-sm">
            <p className="sc-tiny">{sequence.status === 'active' ? 'Currently active' : sequence.status === 'paused' ? 'Currently paused' : 'Currently draft'}</p>
            <p className="sc-body mt-1 text-[var(--sc-ink-soft)]">
              {sequence.steps.length} step{sequence.steps.length === 1 ? '' : 's'} configured for this journey.
            </p>
          </Panel>
        )}
      </header>

      {loading ? (
        <Panel className="space-y-3">
          <Skeleton height={16} className="w-1/3" />
          <Skeleton height={16} className="w-2/3" />
          <Skeleton height={16} className="w-1/2" />
        </Panel>
      ) : fetchError ? (
        <Panel as="section" className="space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-4">
              <Icon name="warning" />
              <div>
                <p className="sc-tiny">Source health</p>
                <Title className="mt-1">Sequence journey could not load</Title>
                <Notice tone="danger">{fetchError}</Notice>
                <p className="sc-body mt-3 text-[0.75rem] text-[var(--sc-ink-soft)]">
                  Journey status, steps, and launch controls stay hidden until the sequence source responds, so teams do not edit from stale or partial follow-up data.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => loadSequence()} aria-label="Retry loading sequence journey">
                <Icon name="refresh" />
                Retry
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
                Back to sequences
              </Button>
            </div>
          </div>
        </Panel>
      ) : sequence ? (
        <SequenceForm initial={sequence} apiScope={orgScope} onSave={handleSave} onCancel={handleCancel} />
      ) : null}
    </div>
  )
}
