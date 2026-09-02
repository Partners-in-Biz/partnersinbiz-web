'use client'

export const dynamic = 'force-dynamic'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { MailboxWorkspace } from '@/components/mailbox/MailboxWorkspace'
import { SharedWithUsSection } from '@/components/crm/SharedWithUsSection'
import { scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function PortalEmailPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  return (
    <>
      <SharedWithUsSection module="email" orgId={orgScope.orgId ?? undefined} companyId={orgScope.sourceCompanyId} />
      <MailboxWorkspace surface="portal" />
    </>
  )
}
