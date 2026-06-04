'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import SocialAccountsManager from '@/components/social/SocialAccountsManager'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export const dynamic = 'force-dynamic'

export default function PortalAccountsPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])

  return (
    <SocialAccountsManager
      orgId={orgScope.orgId}
      basePath={scopedPortalPath('/portal/social/accounts', orgScope)}
    />
  )
}
