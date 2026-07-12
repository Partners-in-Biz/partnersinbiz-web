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
    <div className="max-w-6xl space-y-6">
      <div>
        <button
          type="button"
          onClick={() => router.push(href('/portal/settings/automations'))}
          className="cursor-pointer flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface mb-4 transition-colors"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[14px]">arrow_back</span>
          Automations
        </button>
        <p className="eyebrow !text-[10px]">Email sequence builder</p>
        <h1 className="mt-1 text-base font-semibold text-on-surface">Edit email sequence</h1>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-on-surface-variant">
          Tune the send / wait / branch flow, trigger, and goals. Preview the path before saving.
        </p>
      </div>

      <SequenceBuilder
        sequenceId={id}
        orgScope={orgScope}
        onDone={() => router.push(href('/portal/settings/automations'))}
      />
    </div>
  )
}
