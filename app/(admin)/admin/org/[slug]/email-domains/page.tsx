import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { EmailDomainsWorkspace } from '@/components/email-domains/EmailDomainsWorkspace'

export const dynamic = 'force-dynamic'

export default async function AdminOrgEmailDomainsPage({ params }: { params: Promise<{ slug: string }> }) {
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

  return <EmailDomainsWorkspace orgId={orgDoc.id} orgName={orgName} />
}
