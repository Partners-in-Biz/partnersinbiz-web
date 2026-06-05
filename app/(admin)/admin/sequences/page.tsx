'use client'
export const dynamic = 'force-dynamic'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { SequencesWorkspace } from '@/components/crm/SequencesWorkspace'
import { useOrg } from '@/lib/contexts/OrgContext'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

export default function SequencesPage() {
  const searchParams = useSearchParams()
  const search = searchParams.toString()
  const { selectedOrgId, orgs } = useOrg()

  const orgScope = useMemo(() => {
    const params = new URLSearchParams(search)
    const requestedSlug = params.get('org')?.trim() || params.get('orgSlug')?.trim() || ''
    const requestedOrgId = params.get('orgId')?.trim() || ''
    const selectedOrg = orgs.find((org) => org.id === selectedOrgId)
    const requestedOrg = orgs.find((org) => {
      if (requestedOrgId && org.id === requestedOrgId) return true
      if (requestedSlug && org.slug === requestedSlug) return true
      if (requestedSlug && org.id === requestedSlug) return true
      return false
    })

    return {
      orgId: requestedOrg?.id || requestedOrgId || selectedOrgId || PIB_PLATFORM_ORG_ID,
      orgSlug: requestedOrg?.slug || requestedSlug || selectedOrg?.slug || undefined,
    }
  }, [orgs, search, selectedOrgId])

  return <SequencesWorkspace surface="admin" orgScope={orgScope} />
}
