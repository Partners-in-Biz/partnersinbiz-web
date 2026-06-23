import { AdminBacklogSurface } from '@/components/admin/AdminBacklogSurface'

export const dynamic = 'force-dynamic'

export default async function AdminAbTestDetailPage({
  params,
}: {
  params: Promise<{ testId: string }>
}) {
  const { testId } = await params
  return (
    <AdminBacklogSurface
      endpoint={`/api/v1/admin/ab-tests/${encodeURIComponent(testId)}`}
      eyebrow="Admin backlog"
      title="A/B test results"
      summary="Stored variant counters and winner state for the selected experiment document."
    />
  )
}
