import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { BookProjectWorkspace } from '@/components/book-studio/BookProjectWorkspace'
import { AdminOperatorGate } from '@/components/admin/AdminOperatorGate'

export const dynamic = 'force-dynamic'

export default async function AdminOrgBookStudioDetailPage({ params }: { params: Promise<{ slug: string; bookId: string }> }) {
  const { slug, bookId } = await params
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
        title="Book project release is approval-gated"
        body="Inspect this book project as an operator workspace. Publishing packets, external uploads, and client-visible release actions remain locked until evidence and release-review gates pass."
      />
      <BookProjectWorkspace orgId={orgDoc.id} projectId={bookId} />
    </div>
  )
}
