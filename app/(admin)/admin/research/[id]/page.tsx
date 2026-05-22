import { ResearchDetailClient } from '@/components/research/ResearchDetailClient'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export default async function AdminResearchDetailPage({ params }: Props) {
  const { id } = await params
  return <ResearchDetailClient id={id} mode="admin" basePath="/admin/research" documentsBasePath="/admin/documents" />
}
