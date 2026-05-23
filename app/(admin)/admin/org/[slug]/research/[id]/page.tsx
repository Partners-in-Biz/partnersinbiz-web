import { ResearchDetailClient } from '@/components/research/ResearchDetailClient'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string; id: string }> }

export default async function OrgResearchDetailPage({ params }: Props) {
  const { slug, id } = await params
  return (
    <ResearchDetailClient
      id={id}
      mode="admin"
      basePath={`/admin/org/${slug}/research`}
      documentsBasePath={`/admin/org/${slug}/documents`}
    />
  )
}
