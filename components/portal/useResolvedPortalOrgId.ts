'use client'

import { useEffect, useMemo, useState } from 'react'

type PortalOrgsResponse = {
  activeOrgId?: string | null
}

function cleanOrgId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function useResolvedPortalOrgId(explicitOrgId?: string | null): { orgId?: string; resolving: boolean } {
  const cleanExplicitOrgId = useMemo(() => cleanOrgId(explicitOrgId), [explicitOrgId])
  const [resolvedOrgId, setResolvedOrgId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    if (cleanExplicitOrgId) {
      setResolvedOrgId(cleanExplicitOrgId)
      return
    }

    let cancelled = false
    setResolvedOrgId(undefined)

    fetch('/api/v1/portal/orgs')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`Failed (${res.status})`))))
      .then((body: PortalOrgsResponse) => {
        if (cancelled) return
        setResolvedOrgId(cleanOrgId(body.activeOrgId))
      })
      .catch(() => {
        if (!cancelled) setResolvedOrgId(null)
      })

    return () => {
      cancelled = true
    }
  }, [cleanExplicitOrgId])

  return {
    orgId: cleanExplicitOrgId ?? resolvedOrgId ?? undefined,
    resolving: !cleanExplicitOrgId && resolvedOrgId === undefined,
  }
}
