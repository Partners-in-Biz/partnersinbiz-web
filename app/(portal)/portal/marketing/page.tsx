import { HubPage } from '@/components/navigation/HubPage'
import { buildMarketingHubProps } from '@/components/navigation/marketingHubConfig'

export const dynamic = 'force-dynamic'

export default function PortalMarketingPage() {
  return <HubPage {...buildMarketingHubProps({ surface: 'portal' })} />
}
