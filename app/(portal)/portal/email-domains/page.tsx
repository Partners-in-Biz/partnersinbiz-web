'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { EmailDomainsWorkspace } from '@/components/email-domains/EmailDomainsWorkspace'
import { scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export const dynamic = 'force-dynamic'

export default function PortalEmailDomainsPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])

  return <EmailDomainsWorkspace orgId={orgScope.orgId ?? undefined} />
}
