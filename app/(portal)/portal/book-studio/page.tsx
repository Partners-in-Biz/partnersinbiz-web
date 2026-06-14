import { BookStudioPortalWorkspace } from '@/components/book-studio/BookStudioPortalWorkspace'

export const dynamic = 'force-dynamic'

interface BookStudioPortalPageProps {
  searchParams?: Promise<{ orgId?: string }>
}

export default async function BookStudioPortalPage({ searchParams }: BookStudioPortalPageProps) {
  const params = await searchParams
  const orgId = typeof params?.orgId === 'string' ? params.orgId : undefined

  return <BookStudioPortalWorkspace orgId={orgId} />
}
