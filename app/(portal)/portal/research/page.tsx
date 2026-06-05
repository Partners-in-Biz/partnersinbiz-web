'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { ResearchListClient } from '@/components/research/ResearchListClient'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export const dynamic = 'force-dynamic'

export default function PortalResearchPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])

  return (
    <ResearchListClient
      mode="portal"
      title="Research"
      description="Shared research findings, evidence, and recommendations from Partners in Biz."
      basePath="/portal/research"
      orgId={orgScope.orgId ?? undefined}
      itemHref={(item) => scopedPortalPath(`/portal/research/${item.id}`, orgScope)}
    />
  )
}
