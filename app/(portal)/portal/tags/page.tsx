'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { TagsManager } from '@/components/crm/TagsManager'
import { PageHeader } from '@/components/ui/AppFoundation'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function PortalTagsPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const apiPath = useCallback((path: string) => scopedApiPath(path, orgScope), [orgScope])

  return (
    <div className="flex min-h-0 flex-col gap-8">
      <PageHeader
        eyebrow="CRM"
        title="Tags."
        description="Create, rename, or remove tags across your contact base."
      />
      <TagsManager apiPath={apiPath} />
    </div>
  )
}
