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
    <div className="flex min-h-0 flex-col space-y-8">
      <header className="flex items-start gap-4">
        <span className="pib-icon-tint">
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">label</span>
        </span>
        <div className="min-w-0">
          <p className="eyebrow">CRM</p>
          <h1 className="pib-page-title mt-2">Tags</h1>
          <p className="pib-page-sub max-w-2xl">
            Manage the tags applied across your contact base. Create new tags, rename them
            everywhere at once, or remove a tag from every contact.
          </p>
        </div>
      </header>

      <TagsManager apiPath={apiPath} />
    </div>
  )
}
