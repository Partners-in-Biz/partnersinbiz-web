'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { LeadCaptureSourceForm } from '@/components/capture-sources/LeadCaptureSourceForm'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export const dynamic = 'force-dynamic'

export default function NewLeadCaptureSourcePage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])

  return (
    <LeadCaptureSourceForm
      orgId={orgScope.orgId ?? undefined}
      listHref={scopedPortalPath('/portal/capture-sources', orgScope)}
    />
  )
}
