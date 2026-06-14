import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { YouTubeStudioAdminWorkspace } from '@/components/youtube-studio/YouTubeStudioAdminWorkspace'
import { AdminOperatorGate } from '@/components/admin/AdminOperatorGate'

export const dynamic = 'force-dynamic'

export default async function AdminOrgYouTubeStudioPage({ params }: { params: Promise<{ slug: string }> }) {
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
        title="YouTube publishing is approval-gated"
        body="Use YouTube Studio for operator intake, production, QA, packets, and evidence. Uploads, scheduling, public visibility, and client-visible approvals require cleared Projects/Kanban gates."
      />
      <YouTubeStudioAdminWorkspace orgId={orgDoc.id} orgName={orgName} />
    </div>
  )
}
