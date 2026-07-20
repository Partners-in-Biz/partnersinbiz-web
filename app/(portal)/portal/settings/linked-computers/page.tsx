import { LinkedComputersWorkspace } from '@/components/linked-computers/LinkedComputersWorkspace'
import { ModuleShell } from '@/components/ui/ModuleShell'

export default function LinkedComputersPage() {
  return (
    <ModuleShell tier={1} accent="cyan" className="min-h-0 flex-1">
      <LinkedComputersWorkspace />
    </ModuleShell>
  )
}
