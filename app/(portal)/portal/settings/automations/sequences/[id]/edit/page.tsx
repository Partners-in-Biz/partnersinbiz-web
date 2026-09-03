'use client'
export const dynamic = 'force-dynamic'

import { Icon } from '@/components/studio'
import { PageHeader } from '@/components/ui/AppFoundation'

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
          className="mb-4 inline-flex items-center gap-1 text-xs text-[var(--sc-ink-soft)] transition-colors hover:text-[var(--sc-ink)]"
        >
          <Icon name="arrow_back" />
          Automations
        </button>
        <PageHeader
          title="Edit email sequence."
          description="Tune the send / wait / branch flow, trigger, and goals. Preview the path before saving."
        />
      </header>

      <SequenceBuilder
        sequenceId={id}
        orgScope={orgScope}
        onDone={() => router.push(href('/portal/settings/automations'))}
      />
    </div>
  )
}
