import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { MobileAppsAdminWorkspace } from '@/components/mobile-apps/MobileAppsAdminWorkspace'
import { AdminOperatorGate } from '@/components/admin/AdminOperatorGate'

export const dynamic = 'force-dynamic'

export default async function AdminOrgMobileAppsPage({ params }: { params: Promise<{ slug: string }> }) {
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
        title="Mobile app visibility is approval-gated"
        body="Use this admin workspace for app inventory, ASO notes, release status, and internal access. App Store/Play Store release changes and client-visible portal exposure require approved Projects/Kanban gates."
      />
      <MobileAppsAdminWorkspace orgId={orgDoc.id} orgName={orgName} />
    </div>
  )
}
