'use client'
export const dynamic = 'force-dynamic'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { SequencesWorkspace } from '@/components/crm/SequencesWorkspace'
import { scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function SequencesPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])

  return <SequencesWorkspace surface="portal" orgScope={orgScope} />
}
