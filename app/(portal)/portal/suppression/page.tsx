'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { SuppressionList } from '@/components/crm/SuppressionList'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function PortalSuppressionPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const apiPath = useCallback((path: string) => scopedApiPath(path, orgScope), [orgScope])

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">Email deliverability</p>
        <div className="mt-2">
          <h1 className="pib-page-title">Suppression list</h1>
          <p className="pib-page-sub max-w-2xl">
            Addresses on this list never receive email. Bounces, spam complaints and unsubscribes
            are added automatically — add or import addresses manually, or remove ones added in error.
          </p>
        </div>
      </header>

      <SuppressionList apiPath={apiPath} />
    </div>
  )
}
