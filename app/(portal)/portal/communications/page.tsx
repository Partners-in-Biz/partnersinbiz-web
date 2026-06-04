'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { CommunicationsConsole } from '@/components/communications/CommunicationsConsole'
import { scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export const dynamic = 'force-dynamic'

export default function PortalCommunicationsPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])

  return (
    <CommunicationsConsole
      mode="portal"
      initialOrgId={orgScope.orgId ?? ''}
      initialOrgSlug={orgScope.orgSlug ?? ''}
    />
  )
}
