import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { BookStudioAdminWorkspace } from '@/components/book-studio/BookStudioAdminWorkspace'
import { AdminOperatorGate } from '@/components/admin/AdminOperatorGate'

export const dynamic = 'force-dynamic'

export default async function AdminOrgBookStudioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
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
        title="Book Studio release actions are approval-gated"
        body="Use this admin command center for intake, evidence, rights checks, and publishing packets. External uploads and client-visible release actions stay locked until Projects/Kanban review gates pass."
      />
      <BookStudioAdminWorkspace orgId={orgDoc.id} orgName={orgName} orgSlug={slug} />
    </div>
  )
}
