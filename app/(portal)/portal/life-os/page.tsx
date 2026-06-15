import { LifeOsPlanningWorkbench } from '@/components/self-improvement/LifeOsPlanningWorkbench'

export const metadata = {
  title: 'Life OS Planning | Partners in Biz',
}

export default function PortalLifeOsPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <LifeOsPlanningWorkbench />
      </div>
    </main>
  )
}
