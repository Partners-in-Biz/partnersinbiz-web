'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import SocialHistoryWorkspace from '@/components/social/SocialHistoryWorkspace'
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
      <div className="w-full max-w-7xl mx-auto px-4 py-6 space-y-6">
        <div>
          <h1 className="font-headline text-2xl font-bold tracking-tighter text-[var(--color-on-surface)]">Post History</h1>
          <p className="mt-1 text-sm text-[var(--color-on-surface-variant)]">View all your published and scheduled posts</p>
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, index) => (
            <div key={index} className="pib-skeleton h-24" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <SocialHistoryWorkspace
      title="Post History"
      description="View all your published and scheduled posts"
      limit={200}
      buildApiPath={buildApiPath}
      statusOptions={['all', 'published', 'scheduled', 'draft', 'failed', 'cancelled']}
      showPlatformFilter
    />
  )
}
