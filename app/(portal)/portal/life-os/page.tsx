import { LifeOsPlanningWorkbench } from '@/components/self-improvement/LifeOsPlanningWorkbench'
import { PageHeader } from '@/components/ui/AppFoundation'

export const metadata = {
  title: 'Life OS Planning | Partners in Biz',
}

export default function PortalLifeOsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Life OS."
        description="Plan experiments and reflections for personal operating cadence."
      />
      <LifeOsPlanningWorkbench />
    </div>
  )
}
