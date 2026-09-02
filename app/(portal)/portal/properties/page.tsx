'use client'
export const dynamic = 'force-dynamic'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { PropertiesWorkspace } from '@/components/properties/PropertiesWorkspace'
import { SharedWithUsSection } from '@/components/crm/SharedWithUsSection'
import { scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function PortalProperties() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  return (
    <>
      <SharedWithUsSection module="properties" orgId={orgScope.orgId ?? undefined} companyId={orgScope.sourceCompanyId} />
      <PropertiesWorkspace surface="portal" />
    </>
  )
}
