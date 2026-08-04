'use client'

// Portal org-scope resolution with selected-workspace inheritance.
//
// The portal shell (PortalLayoutClient) resolves the user's active workspace
// server-side and keeps it in local state, but it only injects orgId into the
// URL when the user explicitly switches workspaces. Pages opened directly
// (bookmarks, nav links, deep links) therefore arrive without ?orgId= and
// previously failed with "Select an organisation workspace before opening
// Finance.".
//
// This hook keeps explicit URL scope authoritative (tenant-safe) and falls
// back to the same /api/v1/portal/active-org endpoint the portal layout and
// CommunicationsConsole already use, so selected-workspace surfaces inherit
// the active org automatically.

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { resolvePortalOrgScope, scopeFromSearchParams } from './scoped-routing'

export { resolvePortalOrgScope } from './scoped-routing'

export function usePortalOrgScope(): ReturnType<typeof resolvePortalOrgScope> {
  const searchParams = useSearchParams()
  const urlScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const [activeOrgId, setActiveOrgId] = useState('')

  useEffect(() => {
    // Explicit URL org always wins; no fetch needed.
    if (urlScope.orgId) {
      setActiveOrgId('')
      return
    }
    let cancelled = false
    fetch('/api/v1/portal/active-org', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return
        const orgId = typeof body?.orgId === 'string' ? body.orgId.trim() : ''
        if (orgId) setActiveOrgId(orgId)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [urlScope.orgId])

  return useMemo(
    () => resolvePortalOrgScope(urlScope, activeOrgId),
    [urlScope, activeOrgId],
  )
}
