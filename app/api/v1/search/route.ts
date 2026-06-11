import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

interface SearchResult {
  id: string
  type: 'contact' | 'project' | 'task' | 'invoice'
  title: string
  subtitle?: string
  url: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchesQuery(text: string | undefined, q: string): boolean {
  if (!text) return false
  return text.toLowerCase().includes(q.toLowerCase())
}

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim()
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '5'), 20)

  if (!q || q.length < 2) {
    return apiError('q must be at least 2 characters', 400)
  }

  // Fetch all collections in parallel
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [contactsSnap, projectsSnap, tasksSnap, invoicesSnap] = await Promise.all([
    (adminDb.collection('contacts') as any).limit(200).get(),
    (adminDb.collection('projects') as any).limit(200).get(),
    (adminDb.collectionGroup('tasks') as any).limit(200).get(),
    (adminDb.collection('invoices') as any).limit(200).get(),
  ])

  // Search contacts: match on name, email, company
  const contacts = contactsSnap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any) => ({ id: d.id, ...d.data() }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((d: any) => d.deleted !== true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((d: any) => canAccessOrg(user, d.orgId))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((d: any) =>
      matchesQuery(d.name, q) ||
      matchesQuery(d.email, q) ||
      matchesQuery(d.company, q)
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .slice(0, limit)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any): SearchResult => ({
      id: d.id,
      type: 'contact',
      title: d.name,
      subtitle: d.company || d.email,
      url: `/portal/crm/contacts/${d.id}`,
    }))

  // Search projects: match on name, description
  const matchedProjects = projectsSnap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any) => ({ id: d.id, ...d.data() }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((d: any) => d.deleted !== true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((d: any) => canAccessOrg(user, d.orgId))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((d: any) =>
      matchesQuery(d.name, q) ||
      matchesQuery(d.description, q)
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .slice(0, limit) as any[]

  // Search tasks: match on title, description
  const matchedTasks = tasksSnap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any) => {
      const data = d.data()
      // collectionGroup returns DocumentReference, extract parent project ID
      const parentPath = d.ref.parent.parent?.id || ''
      return { id: d.id, projectId: parentPath, ...data }
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((d: any) => d.deleted !== true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((d: any) => canAccessOrg(user, d.orgId))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((d: any) =>
      matchesQuery(d.title, q) ||
      matchesQuery(d.description, q)
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .slice(0, limit) as any[]

  // Batch-fetch org docs to resolve orgId → slug for correct URLs
  const orgIdSet = new Set<string>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  matchedProjects.forEach((d: any) => { if (d.orgId) orgIdSet.add(d.orgId) })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  matchedTasks.forEach((d: any) => { if (d.orgId) orgIdSet.add(d.orgId) })

  const orgSlugMap = new Map<string, string>()
  if (orgIdSet.size > 0) {
    const orgRefs = Array.from(orgIdSet).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (id) => (adminDb.collection('organizations') as any).doc(id)
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orgDocs = await (adminDb as any).getAll(...orgRefs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    orgDocs.forEach((doc: any) => {
      if (doc.exists) {
        const data = doc.data()
        if (data?.slug) orgSlugMap.set(doc.id, data.slug)
      }
    })
  }

  const projects = matchedProjects
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any): SearchResult => {
      const slug = d.orgId ? orgSlugMap.get(d.orgId) : undefined
      const url = slug
        ? `/admin/org/${slug}/projects/${d.id}`
        : `/portal/projects/${d.id}`
      return {
        id: d.id,
        type: 'project',
        title: d.name,
        subtitle: d.description,
        url,
      }
    })

  const tasks = matchedTasks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any): SearchResult => {
      const slug = d.orgId ? orgSlugMap.get(d.orgId) : undefined
      const url = slug
        ? `/admin/org/${slug}/projects/${d.projectId}?task=${d.id}`
        : `/portal/projects/${d.projectId}?task=${d.id}`
      return {
        id: d.id,
        type: 'task',
        title: d.title,
        subtitle: d.status,
        url,
      }
    })

  // Search invoices: match on invoiceNumber, notes
  const invoices = invoicesSnap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any) => ({ id: d.id, ...d.data() }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((d: any) => d.deleted !== true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((d: any) => canAccessOrg(user, d.orgId))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((d: any) =>
      matchesQuery(d.invoiceNumber, q) ||
      matchesQuery(d.notes, q)
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .slice(0, limit)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any): SearchResult => ({
      id: d.id,
      type: 'invoice',
      title: d.invoiceNumber,
      subtitle: `${d.currency} ${d.total?.toLocaleString() ?? '0'}`,
      url: `/portal/invoicing/${d.id}`,
    }))

  // Combine all results
  const results = [...contacts, ...projects, ...tasks, ...invoices].slice(0, limit * 4)

  return apiSuccess({
    results,
    query: q,
    total: results.length,
  })
})
