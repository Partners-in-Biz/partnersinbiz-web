import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { BookSeriesWorkspace } from '@/components/book-studio/BookSeriesWorkspace'
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

  return (
    <div className="space-y-6">
      <AdminOperatorGate
        title="Book series workspace is approval-gated"
        body="Series planning is operator-only until records, source evidence, rights checks, and release-review gates are linked through Projects/Kanban."
      />
      <BookSeriesWorkspace orgId={orgDoc.id} seriesId={seriesId} />
    </div>
  )
}
