import { AdminBacklogSurface } from '@/components/admin/AdminBacklogSurface'

export const dynamic = 'force-dynamic'

export default function AdminHermesPage() {
  return (
    <AdminBacklogSurface
      endpoint="/api/v1/admin/hermes"
      eyebrow="Admin operations"
      title="Hermes control plane"
      summary="Profile links, recent Hermes run status, safe profile API handoffs, and shortcuts into agents, jobs, skills, and infrastructure metrics."
    />
  )
}
