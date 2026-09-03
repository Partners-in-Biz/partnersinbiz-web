'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import SocialHistoryWorkspace from '@/components/social/SocialHistoryWorkspace'
import { PageHeader } from '@/components/ui/AppFoundation'
import { Skeleton } from '@/components/studio'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function PortalPostHistory() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const [resolvedOrgId, setResolvedOrgId] = useState<string | null | undefined>(undefined)
  const effectiveOrgId = orgScope.orgId ?? resolvedOrgId
  const resolvingOrg = !orgScope.orgId && resolvedOrgId === undefined
  const resolvedScope = useMemo(() => ({
    ...orgScope,
    orgId: effectiveOrgId,
  }), [effectiveOrgId, orgScope])
  const buildApiPath = useCallback((path: string) => scopedApiPath(path, resolvedScope), [resolvedScope])

  useEffect(() => {
    if (orgScope.orgId) {
      setResolvedOrgId(orgScope.orgId)
      return
    }

    let cancelled = false

    async function resolveActiveOrg() {
      try {
        const res = await fetch(scopedApiPath('/api/v1/portal/org', orgScope))
        const body = res.ok ? await res.json().catch(() => null) : null
        const orgId = typeof body?.org?.id === 'string' ? body.org.id : null
        if (!cancelled) setResolvedOrgId(orgId)
      } catch {
        if (!cancelled) setResolvedOrgId(null)
      }
    }

    setResolvedOrgId(undefined)
    resolveActiveOrg()

    return () => {
      cancelled = true
    }
  }, [orgScope])

  if (resolvingOrg) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-8 px-4 py-6">
        <PageHeader
          eyebrow="Social"
          title="Post history."
          description="View all your published and scheduled posts."
        />
        <div className="space-y-3">
          {[...Array(5)].map((_, index) => (
            <Skeleton key={index} height={96} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <SocialHistoryWorkspace
      title="Post history."
      description="View all your published and scheduled posts."
      limit={200}
      buildApiPath={buildApiPath}
      statusOptions={['all', 'published', 'scheduled', 'draft', 'failed', 'cancelled']}
      showPlatformFilter
    />
  )
}
