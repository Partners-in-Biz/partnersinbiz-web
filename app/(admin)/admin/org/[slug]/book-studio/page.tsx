import { AdminBookStudioGovernanceWorkspace } from '@/components/book-studio/AdminBookStudioGovernanceWorkspace'

export const dynamic = 'force-dynamic'

export default async function AdminOrgBookStudioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <AdminBookStudioGovernanceWorkspace orgSlug={slug} />
}
