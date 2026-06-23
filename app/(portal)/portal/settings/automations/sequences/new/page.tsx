'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import SequenceBuilder from '@/components/email/SequenceBuilder'

export default function NewSequencePage() {
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
          className="cursor-pointer flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] mb-4 transition-colors"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[14px]">arrow_back</span>
          Automations
        </button>
        <p className="eyebrow !text-[10px]">Email sequence builder</p>
        <h1 className="pib-page-title mt-2">New email sequence</h1>
        <p className="pib-page-sub max-w-2xl">
          Build a visual send / wait / branch flow, configure its enrollment trigger, and preview the
          path a contact would walk before it goes live.
        </p>
      </div>

      <SequenceBuilder
        orgScope={orgScope}
        onDone={() => router.push(href('/portal/settings/automations'))}
      />
    </div>
  )
}
