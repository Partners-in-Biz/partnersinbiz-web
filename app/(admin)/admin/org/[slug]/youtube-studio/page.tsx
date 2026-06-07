import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { YouTubeStudioPlaceholder } from '@/components/youtube-studio/YouTubeStudioPlaceholder'

export const dynamic = 'force-dynamic'

export default async function AdminOrgYouTubeStudioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const snap = await adminDb
    .collection('organizations')
    .where('slug', '==', slug)
    .limit(1)
    .get()

  if (snap.empty) notFound()

  const org = snap.docs[0].data() ?? {}
  const orgName = typeof org.name === 'string' && org.name.trim() ? org.name.trim() : slug

  return <YouTubeStudioPlaceholder surface="admin" orgName={orgName} />
}
