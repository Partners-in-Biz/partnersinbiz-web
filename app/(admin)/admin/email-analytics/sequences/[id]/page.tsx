'use client'

export const dynamic = 'force-dynamic'

import { SequenceAnalyticsWorkspace } from '@/components/email-analytics/SequenceAnalyticsWorkspace'

export default function SequenceAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return <SequenceAnalyticsWorkspace params={params} surface="admin" />
}
