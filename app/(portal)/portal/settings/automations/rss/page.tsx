'use client'
export const dynamic = 'force-dynamic'

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
    <div className="max-w-5xl space-y-6">
      <div>
        <button
          type="button"
          onClick={() => router.push(href('/portal/settings/automations'))}
          className="cursor-pointer flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] mb-4 transition-colors"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[14px]">arrow_back</span>
          Automations
        </button>
        <p className="eyebrow !text-[10px]">RSS to email</p>
        <h1 className="pib-page-title mt-2">RSS digest automations</h1>
        <p className="pib-page-sub max-w-2xl">
          Auto-email your audience when new posts hit an RSS or Atom feed. Pick a feed, a schedule, and
          a recipient segment or tag — the platform fetches new items and sends the digest.
        </p>
      </div>

      <RssAutomationManager orgScope={orgScope} />
    </div>
  )
}
