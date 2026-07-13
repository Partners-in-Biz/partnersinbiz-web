'use client'
export const dynamic = 'force-dynamic'

import { use, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import SequenceBuilder from '@/components/email/SequenceBuilder'

export default function EditSequencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const href = useCallback((path: string) => scopedPortalPath(path, orgScope), [orgScope])

  return (
    <div className="max-w-6xl space-y-8">
      <header>
        <button
          type="button"
          onClick={() => router.push(href('/portal/settings/automations'))}
          className="mb-4 flex cursor-pointer items-center gap-1 text-xs text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)]"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[14px]">arrow_back</span>
          Automations
        </button>
        <p className="eyebrow">Settings · Email sequence builder</p>
        <h1 className="pib-page-title mt-2">Edit email sequence</h1>
        <p className="pib-page-sub max-w-2xl">
          Tune the send / wait / branch flow, trigger, and goals. Preview the path before saving.
        </p>
      </header>

      <SequenceBuilder
        sequenceId={id}
        orgScope={orgScope}
        onDone={() => router.push(href('/portal/settings/automations'))}
      />
    </div>
  )
}
