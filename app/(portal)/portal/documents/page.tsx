'use client'
export const dynamic = 'force-dynamic'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { ClientDocumentsWorkspace } from '@/components/client-documents/ClientDocumentsWorkspace'
import { SharedWithUsSection } from '@/components/crm/SharedWithUsSection'
import { scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function PortalDocuments() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  return (
    <>
      <SharedWithUsSection module="documents" orgId={orgScope.orgId ?? undefined} companyId={orgScope.sourceCompanyId} />
      <ClientDocumentsWorkspace surface="portal" />
    </>
  )
}
