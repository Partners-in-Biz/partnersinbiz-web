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
    <div className="space-y-8">
      <header>
        <p className="eyebrow">CRM</p>
        <div className="mt-2">
          <h1 className="pib-page-title">Tags</h1>
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
