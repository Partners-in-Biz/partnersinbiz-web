'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { ContactsWorkspace } from '@/components/crm/ContactsWorkspace'
import { scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export const dynamic = 'force-dynamic'

export default function PortalContactsPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])

  return <ContactsWorkspace mode="portal" orgScope={orgScope} searchParams={searchParams} />
}
