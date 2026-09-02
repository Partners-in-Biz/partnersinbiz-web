'use client'
export const dynamic = 'force-dynamic'

import { useMemo } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { PropertyDetailWorkspace } from '@/components/properties/PropertyDetailWorkspace'
import { CompanyWorkRecordControls } from '@/components/crm/CompanyWorkRecordControls'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function PortalPropertyDetail() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const scope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const backHref = scopedPortalPath('/portal/properties', scope)

  return (
    <>
      <CompanyWorkRecordControls
        className="mb-4"
        module="properties"
        recordId={params.id}
        orgId={scope.orgId}
      />
      <PropertyDetailWorkspace backHref={backHref} />
    </>
  )
}
