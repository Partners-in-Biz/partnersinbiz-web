import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { BookStudioAdminWorkspace, type BookStudioProject } from '@/components/book-studio/BookStudioAdminWorkspace'
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
  const org = orgDoc.data() ?? {}
  const orgName = typeof org.name === 'string' && org.name.trim() ? org.name.trim() : slug
  const project: BookStudioProject = {
    id: bookId,
    title: `Book project ${bookId}`,
    stage: 'quality_gates',
    risk: 'needs_evidence',
    nextAction: 'Resolve evidence and approval gates before preparing a publishing packet.',
    gates: [
      { id: 'client-safe', label: 'Client-safe brief/proof/packet', status: 'missing_evidence', owner: 'Iris', evidence: [] },
      { id: 'rights', label: 'Rights and safety blockers', status: 'missing_evidence', owner: 'Sage', evidence: [] },
      { id: 'release-review', label: 'Human release review', status: 'blocked', owner: 'Quinn', evidence: [] },
    ],
  }

  return (
    <div className="space-y-6">
      <AdminOperatorGate
        title="Book project release is approval-gated"
        body="Inspect this book project as an operator workspace. Publishing packets, external uploads, and client-visible release actions remain locked until evidence and release-review gates pass."
      />
      <BookStudioAdminWorkspace orgId={orgDoc.id} orgName={orgName} orgSlug={slug} projects={[project]} />
    </div>
  )
}
