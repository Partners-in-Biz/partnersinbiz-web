import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { BookStudioAdminWorkspace } from '@/components/book-studio/BookStudioAdminWorkspace'

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

  return <BookStudioAdminWorkspace orgId={orgDoc.id} orgName={orgName} orgSlug={slug} />
}
