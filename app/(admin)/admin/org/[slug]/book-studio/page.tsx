import { notFound } from 'next/navigation'
import { resolveOrgIdBySlugOrId } from '@/lib/organizations/resolve-by-slug'
import { BookStudioAdminIndexTabs } from '@/components/book-studio/BookStudioAdminIndexTabs'

export const dynamic = 'force-dynamic'

export default async function AdminOrgBookStudioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlugOrId(slug)

  if (!orgId) notFound()

  return <BookStudioAdminIndexTabs orgId={orgId} orgSlug={slug} />
}
