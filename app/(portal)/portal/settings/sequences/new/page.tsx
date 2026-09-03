'use client'
export const dynamic = 'force-dynamic'

import { useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { SequenceForm } from '@/components/crm/SequenceForm'
import { PageHeader } from '@/components/ui/AppFoundation'
import { Button, Icon, Panel } from '@/components/studio'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function NewSequencePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const sequencesHref = useMemo(() => scopedPortalPath('/portal/settings/sequences', orgScope), [orgScope])

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
            title="New sequence."
            description="Build a CRM follow-up path with clear timing, channel choices, and launch readiness before contacts enter it."
          />
        </div>
        <Panel flat className="w-full max-w-sm">
          <p className="sc-tiny">Recommended starting point</p>
          <p className="sc-body mt-1 text-[var(--sc-ink-soft)]">
            Keep the first journey short: one immediate confirmation, one value follow-up, and one human handoff.
          </p>
        </Panel>
      </header>

      <SequenceForm apiScope={orgScope} initial={{ orgId: orgScope.orgId ?? undefined }} onSave={handleSave} onCancel={handleCancel} />
    </div>
  )
}
