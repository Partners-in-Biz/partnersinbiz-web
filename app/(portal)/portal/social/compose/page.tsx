'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import SocialPostComposer from '@/components/social/SocialPostComposer'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export const dynamic = 'force-dynamic'

export default function PortalComposePage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])

  return (
    <SocialPostComposer
      orgId={orgScope.orgId}
      accountsHref={scopedPortalPath('/portal/social/accounts', orgScope)}
      afterSaveHref={scopedPortalPath('/portal/social', orgScope)}
    />
  )
}
