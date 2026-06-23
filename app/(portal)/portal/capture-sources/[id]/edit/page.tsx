'use client'

import { use, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { LeadCaptureSourceForm } from '@/components/capture-sources/LeadCaptureSourceForm'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export const dynamic = 'force-dynamic'

export default function EditLeadCaptureSourcePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  // Next.js 15: route params is a Promise — unwrap it in the client component.
  const { id } = use(params)
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])

  return (
    <LeadCaptureSourceForm
      orgId={orgScope.orgId ?? undefined}
      sourceId={id}
      listHref={scopedPortalPath('/portal/capture-sources', orgScope)}
    />
  )
}
