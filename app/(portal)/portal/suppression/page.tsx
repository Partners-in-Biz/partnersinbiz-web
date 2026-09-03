'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { SuppressionList } from '@/components/crm/SuppressionList'
import { PageHeader } from '@/components/ui/AppFoundation'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function PortalSuppressionPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const apiPath = useCallback((path: string) => scopedApiPath(path, orgScope), [orgScope])

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="CRM"
        title="Suppression list."
        description="Addresses on this list never receive email. Bounces, complaints, and unsubscribes are added automatically."
      />
      <SuppressionList apiPath={apiPath} />
    </div>
  )
}
