import { CommunicationsConsole } from '@/components/communications/CommunicationsConsole'

export const dynamic = 'force-dynamic'

interface AdminCommunicationsPageProps {
  searchParams?: Promise<{ orgId?: string; org?: string; orgSlug?: string }>
}

export default async function AdminCommunicationsPage({ searchParams }: AdminCommunicationsPageProps) {
  const params = await searchParams
  return (
    <CommunicationsConsole
      mode="admin"
      initialOrgId={params?.orgId}
      initialOrgSlug={params?.orgSlug ?? params?.org}
    />
  )
}
