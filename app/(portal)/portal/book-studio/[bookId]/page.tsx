import { redirect } from 'next/navigation'
import { BookProjectPortalMount } from '@/components/book-studio/BookProjectPortalMount'

export const dynamic = 'force-dynamic'

interface PortalBookProjectPageProps {
  params: Promise<{ bookId: string }>
  searchParams?: Promise<{ orgId?: string }>
}

export default async function PortalBookProjectPage({ params, searchParams }: PortalBookProjectPageProps) {
  const { bookId } = await params
  if (!bookId) redirect('/portal/book-studio')
  const search = await searchParams
  const orgId = typeof search?.orgId === 'string' ? search.orgId : undefined
  return <BookProjectPortalMount projectId={bookId} orgId={orgId} />
}
