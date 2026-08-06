// app/(portal)/portal/settings/layout.tsx
//
// Settings-mode shell guard: the CRM configuration pages (pipelines, scoring,
// products, automations, sequences, webhooks, custom fields, CRM setup) are
// gated by the per-member `configuration` module. A member without the grant
// who opens one of those URLs directly (bookmark, old link) is redirected back
// to the CRM command center instead of seeing a dead-end "no access" shell.
// Non-configuration settings pages (profile, account, security, sessions, …)
// render children immediately; this layout stays a passthrough for them.

'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { canAccessModule, normalizeMemberAccessPolicy, type MemberAccessPolicy } from '@/lib/orgMembers/access-policy'

const CONFIGURATION_ROUTE_PREFIXES = [
  '/portal/settings/crm-setup',
  '/portal/settings/pipelines',
  '/portal/settings/custom-fields',
  '/portal/settings/scoring',
  '/portal/settings/products',
  '/portal/settings/automations',
  '/portal/settings/sequences',
  '/portal/settings/webhooks',
]

function isConfigurationRoute(pathname: string): boolean {
  return CONFIGURATION_ROUTE_PREFIXES.some((prefix) => (
    pathname === prefix || pathname.startsWith(prefix + '/')
  ))
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [policy, setPolicy] = useState<MemberAccessPolicy | null>(null)

  const configRoute = isConfigurationRoute(pathname)
  const orgId = searchParams.get('orgId')?.trim() ?? ''

  useEffect(() => {
    if (!configRoute) return
    let cancelled = false
    const orgQuery = orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''
    fetch(`/api/v1/portal/org${orgQuery}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return
        if (body?.user?.accessPolicy) setPolicy(normalizeMemberAccessPolicy(body.user.accessPolicy))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [configRoute, orgId])

  useEffect(() => {
    if (!configRoute || !policy) return
    if (!canAccessModule(policy, 'configuration')) {
      router.replace('/portal/crm')
    }
  }, [configRoute, policy, router])

  // Non-configuration settings pages are always served immediately. Config
  // routes render children only after the grant is confirmed so a member
  // without access never sees a flash of configuration content before the
  // redirect (fail-closed until verified).
  if (configRoute && !canAccessModule(policy, 'configuration')) return null
  return <>{children}</>
}
