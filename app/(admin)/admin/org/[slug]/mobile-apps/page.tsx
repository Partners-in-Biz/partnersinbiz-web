import { AdminMobileAppsGovernanceWorkspace } from '@/components/mobile-apps/AdminMobileAppsGovernanceWorkspace'

export const dynamic = 'force-dynamic'

export default async function AdminOrgMobileAppsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <AdminMobileAppsGovernanceWorkspace orgSlug={slug} />
}
