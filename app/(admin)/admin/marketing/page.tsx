import { HubPage } from '@/components/navigation/HubPage'
import { buildMarketingHubProps } from '@/components/navigation/marketingHubConfig'

export const dynamic = 'force-dynamic'

export default function AdminMarketingPage() {
  return <HubPage {...buildMarketingHubProps({ surface: 'admin' })} />
}
