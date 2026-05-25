import { notFound, redirect } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { resolveOrgSlugForLink } from '@/lib/projects/links'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ projectId: string }>
  searchParams?: Promise<{ task?: string; taskId?: string }>
}

export default async function LegacyAdminProjectRedirectPage({ params, searchParams }: PageProps) {
  const { projectId } = await params
  const query = await searchParams
  const projectDoc = await adminDb.collection('projects').doc(projectId).get()
  if (!projectDoc.exists) notFound()

  const orgId = projectDoc.data()?.orgId
  if (typeof orgId !== 'string' || !orgId.trim()) redirect('/admin/projects')

  const orgSlug = await resolveOrgSlugForLink(adminDb, orgId)
  if (!orgSlug) redirect('/admin/projects')

  const taskId = query?.taskId ?? query?.task
  const destination = new URL(`/admin/org/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectId)}`, 'https://partnersinbiz.online')
  if (taskId) destination.searchParams.set('taskId', taskId)

  redirect(`${destination.pathname}${destination.search}`)
}
