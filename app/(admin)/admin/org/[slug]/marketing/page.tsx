'use client'

import { useParams } from 'next/navigation'
import { HubPage } from '@/components/navigation/HubPage'
import { buildMarketingHubProps } from '@/components/navigation/marketingHubConfig'

export const dynamic = 'force-dynamic'

export default function OrgMarketingPage() {
  const params = useParams()
  const slug = params.slug as string

  return <HubPage {...buildMarketingHubProps({ surface: 'admin-org', slug })} />
}
