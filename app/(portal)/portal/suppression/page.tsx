'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { SuppressionList } from '@/components/crm/SuppressionList'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function PortalSuppressionPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const apiPath = useCallback((path: string) => scopedApiPath(path, orgScope), [orgScope])

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <header className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/55 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">block</span>
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Email deliverability</p>
            <h1 className="text-sm font-semibold text-on-surface">Suppression list</h1>
          </div>
        </div>
        <p className="mt-1.5 max-w-2xl text-xs leading-5 text-on-surface-variant">
          Addresses on this list never receive email. Bounces, spam complaints and unsubscribes
          are added automatically — add or import addresses manually, or remove ones added in error.
        </p>
      </header>

      <SuppressionList apiPath={apiPath} />
    </div>
  )
}
