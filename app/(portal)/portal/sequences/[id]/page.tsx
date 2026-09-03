'use client'
export const dynamic = 'force-dynamic'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { SequenceForm } from '@/components/crm/SequenceForm'
import { useOrg } from '@/lib/contexts/OrgContext'
import { appendQueryParams, scopedApiPath } from '@/lib/portal/scoped-routing'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import type { Sequence } from '@/lib/sequences/types'
import { Icon } from '@/components/studio'

export default function SequenceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const search = searchParams.toString()
  const { selectedOrgId, orgs } = useOrg()

  const orgScope = useMemo(() => {
    const params = new URLSearchParams(search)
    const requestedSlug = params.get('org')?.trim() || params.get('orgSlug')?.trim() || ''
    const requestedOrgId = params.get('orgId')?.trim() || ''
    const selectedOrg = orgs.find((org) => org.id === selectedOrgId)
    const requestedOrg = orgs.find((org) => {
      if (requestedOrgId && org.id === requestedOrgId) return true
      if (requestedSlug && org.slug === requestedSlug) return true
      if (requestedSlug && org.id === requestedSlug) return true
      return false
    })

    return {
      orgId: requestedOrg?.id || requestedOrgId || selectedOrgId || PIB_PLATFORM_ORG_ID,
      orgSlug: requestedOrg?.slug || requestedSlug || selectedOrg?.slug || undefined,
    }
  }, [orgs, search, selectedOrgId])

  const sequencesHref = useMemo(
    () => appendQueryParams('/portal/sequences', {
      orgId: orgScope.orgId,
      orgSlug: orgScope.orgSlug,
      org: orgScope.orgSlug,
    }),
    [orgScope],
  )
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
          <button
            type="button"
            onClick={handleCancel}
            className="mb-4 flex cursor-pointer items-center gap-1 text-xs text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)]"
          >
            <Icon name="arrow_back" />
            Sequences
          </button>
          <p className="eyebrow">Email · Journey builder</p>
          <h1 className="pib-page-title mt-2">Edit sequence</h1>
          <p className="pib-page-sub">
            Tune the company follow-up journey while keeping the CRM automation path scoped to the selected organisation.
          </p>
        </div>
        {sequence && (
          <div className="pib-card w-full max-w-sm">
            <div className="flex items-start gap-3">
              <Icon name="route" />
              <div>
                <p className="text-xs font-medium">
                  {sequence.status === 'active' ? 'Currently active' : sequence.status === 'paused' ? 'Currently paused' : 'Currently draft'}
                </p>
                <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                  {sequence.steps.length} step{sequence.steps.length === 1 ? '' : 's'} configured for this journey.
                </p>
              </div>
            </div>
          </div>
        )}
      </header>

      {loading ? (
        <div className="pib-skeleton h-24" />
      ) : fetchError ? (
        <section className="pib-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <Icon name="warning" />
              <div>
                <p className="pib-label">Source health</p>
                <h2 className="pib-page-title mt-1 text-xl">
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
                className="btn-pib-secondary"
              >
                <Icon name="refresh" />
                Retry
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="btn-pib-ghost"
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
