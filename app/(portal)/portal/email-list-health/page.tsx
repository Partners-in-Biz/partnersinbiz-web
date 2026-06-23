'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { ListHealthWorkspace } from '@/components/email-domains/ListHealthWorkspace'
import { scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export const dynamic = 'force-dynamic'

export default function PortalEmailListHealthPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])

  return <ListHealthWorkspace orgId={orgScope.orgId ?? undefined} />
}
