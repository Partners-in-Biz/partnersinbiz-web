import { AdminYouTubeStudioGovernanceWorkspace } from '@/components/youtube-studio/AdminYouTubeStudioGovernanceWorkspace'

export const dynamic = 'force-dynamic'

export default async function AdminOrgYouTubeStudioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <AdminYouTubeStudioGovernanceWorkspace orgSlug={slug} />
}
