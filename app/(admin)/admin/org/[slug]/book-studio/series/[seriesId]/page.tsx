import { notFound } from 'next/navigation'
import { resolveOrgIdBySlugOrId } from '@/lib/organizations/resolve-by-slug'
import { BookSeriesWorkspace } from '@/components/book-studio/BookSeriesWorkspace'
import { AdminOperatorGate } from '@/components/admin/AdminOperatorGate'

export const dynamic = 'force-dynamic'

export default async function AdminOrgBookStudioSeriesPage({ params }: { params: Promise<{ slug: string; seriesId: string }> }) {
  const { slug, seriesId } = await params
  const orgId = await resolveOrgIdBySlugOrId(slug)

  if (!orgId) notFound()

  return (
    <div className="space-y-6">
      <AdminOperatorGate
        title="Book series workspace is approval-gated"
        body="Series planning is operator-only until records, source evidence, rights checks, and release-review gates are linked through Projects/Kanban."
      />
      <BookSeriesWorkspace orgId={orgId} seriesId={seriesId} />
    </div>
  )
}
