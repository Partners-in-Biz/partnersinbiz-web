import { IngestionMonitor } from '@/components/admin/governance/IngestionMonitor'

export const dynamic = 'force-dynamic'

export default function AdminAnalyticsIngestionPage() {
  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <IngestionMonitor />
    </div>
  )
}
