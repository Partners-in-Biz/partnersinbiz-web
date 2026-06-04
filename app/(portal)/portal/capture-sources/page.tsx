'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { CaptureSourcesWorkspace } from '@/components/capture-sources/CaptureSourcesWorkspace'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export const dynamic = 'force-dynamic'

export default function PortalCaptureSourcesPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])

  return (
    <CaptureSourcesWorkspace
      orgId={orgScope.orgId ?? undefined}
      importHref={scopedPortalPath('/portal/capture-sources/import', orgScope)}
      sequenceNewHref={scopedPortalPath('/portal/settings/sequences/new', orgScope)}
    />
  )
}
