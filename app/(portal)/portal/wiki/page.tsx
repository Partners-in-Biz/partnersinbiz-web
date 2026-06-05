'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { KnowledgeBrowser } from '@/components/knowledge/KnowledgeBrowser'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export const dynamic = 'force-dynamic'

export default function PortalWikiPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const apiPath = useMemo(() => scopedApiPath('/api/v1/portal/knowledge', orgScope), [orgScope])

  return (
    <KnowledgeBrowser
      scope="agent"
      apiPath={apiPath}
      readOnly
      sections={['wiki', 'logs']}
      eyebrow="Workspace"
      title="Wiki"
      description="Read-only knowledge notes and activity logs shared with your workspace."
    />
  )
}
