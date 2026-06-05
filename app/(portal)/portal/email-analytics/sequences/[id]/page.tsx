'use client'

export const dynamic = 'force-dynamic'

import {
  SequenceAnalyticsWorkspace,
  type SequenceAnalyticsSearchParams,
} from '@/components/email-analytics/SequenceAnalyticsWorkspace'

export default function PortalSequenceAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<SequenceAnalyticsSearchParams>
}) {
  return (
    <SequenceAnalyticsWorkspace
      params={params}
      searchParams={searchParams}
      surface="portal"
    />
  )
}
