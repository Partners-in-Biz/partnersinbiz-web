'use client'
export const dynamic = 'force-dynamic'

import { Icon } from '@/components/studio'
import { PageHeader } from '@/components/ui/AppFoundation'

import { useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import RssAutomationManager from '@/components/email/RssAutomationManager'

export default function RssAutomationsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const href = useCallback((path: string) => scopedPortalPath(path, orgScope), [orgScope])

  return (
    <div className="max-w-5xl space-y-8">
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
          title="RSS digest automations."
          description="Auto-email your audience when new posts hit an RSS or Atom feed. Pick a feed, a schedule, and a recipient segment or tag. The platform fetches new items and sends the digest."
        />
      </header>

      <RssAutomationManager orgScope={orgScope} />
    </div>
  )
}
