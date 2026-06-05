'use client'

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useOrg } from '@/lib/contexts/OrgContext'

function routeOrgSlug(pathname: string): string {
  const match = pathname.match(/^\/admin\/org\/([^/]+)/)
  return match?.[1] ? decodeURIComponent(match[1]) : ''
}

export function AdminRouteOrgSync() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = searchParams.toString()
  const { selectedOrgId, orgs, setOrg } = useOrg()

  useEffect(() => {
    if (!orgs.length) return

    const params = new URLSearchParams(search)
    const slug = routeOrgSlug(pathname) || params.get('org') || params.get('orgSlug') || ''
    const orgId = params.get('orgId') || ''
    const target = orgs.find((org) => {
      if (slug && org.slug === slug) return true
      if (slug && org.id === slug) return true
      if (orgId && org.id === orgId) return true
      return false
    })

    if (target && target.id !== selectedOrgId) {
      setOrg(target.id, target.name)
    }
  }, [orgs, pathname, search, selectedOrgId, setOrg])

  return null
}
