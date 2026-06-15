import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { BookStudioAdminWorkspace } from '@/components/book-studio/BookStudioAdminWorkspace'
import { AdminOperatorGate } from '@/components/admin/AdminOperatorGate'

export const dynamic = 'force-dynamic'

export default async function AdminOrgBookStudioSeriesPage({ params }: { params: Promise<{ slug: string; seriesId: string }> }) {
  const { slug, seriesId } = await params
  const snap = await adminDb
    .collection('organizations')
    .where('slug', '==', slug)
    .limit(1)
    .get()

  if (snap.empty) notFound()

  const orgDoc = snap.docs[0]
  const org = orgDoc.data() ?? {}
  const orgName = typeof org.name === 'string' && org.name.trim() ? org.name.trim() : slug

  return (
    <div className="space-y-6">
      <AdminOperatorGate
        title="Book series workspace is approval-gated"
        body="Series planning is operator-only until records, source evidence, rights checks, and release-review gates are linked through Projects/Kanban."
      />
      <BookStudioAdminWorkspace
        orgId={orgDoc.id}
        orgName={orgName}
        orgSlug={slug}
        error={`Series workspace ${seriesId} has no loaded Book Studio records yet`}
      />
    </div>
  )
}
