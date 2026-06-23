'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { DeliverabilityWorkspace } from '@/components/email-domains/DeliverabilityWorkspace'
import { scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export const dynamic = 'force-dynamic'

export default function PortalEmailDeliverabilityPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])

  return <DeliverabilityWorkspace orgId={orgScope.orgId ?? undefined} />
}
