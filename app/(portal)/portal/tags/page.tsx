'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { TagsManager } from '@/components/crm/TagsManager'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function PortalTagsPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const apiPath = useCallback((path: string) => scopedApiPath(path, orgScope), [orgScope])

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <header className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/55 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">label</span>
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">CRM</p>
            <h1 className="text-sm font-semibold text-on-surface">Tags</h1>
          </div>
        </div>
        <p className="mt-1.5 max-w-2xl text-xs leading-5 text-on-surface-variant">
          Manage the tags applied across your contact base. Create new tags, rename them
          everywhere at once, or remove a tag from every contact.
        </p>
      </header>

      <TagsManager apiPath={apiPath} />
    </div>
  )
}
