import type { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'

export type OrgDashboardDeepLinks = {
  dashboard: string
  projects: string
  social: string
  socialQueue: string
  socialCalendar: string
  tasks: string
  inbox: string
  approvals: string
  documents: string
}

export type OrgDashboardAggregate = {
  org: {
    id: string
    slug: string
    name: string
    links: {
      admin: string
      portal: string
    }
  }
  deepLinks: OrgDashboardDeepLinks
  projects: {
    total: number
    active: number
    recent: DashboardResource[]
  }
  social: {
    total: number
    byStatus: Record<string, number>
    pendingApproval: number
    scheduledUpcoming: number
    upcoming: DashboardResource[]
  }
  tasks: {
    totalOpen: number
    overdue: number
    byStatus: Record<string, number>
    byAgentStatus: Record<string, number>
    upcoming: DashboardResource[]
  }
  inbox: {
    totalAttention: number
    unreadNotifications: number
    approvals: number
    recent: DashboardResource[]
  }
  documents: {
    total: number
    byStatus: Record<string, number>
    openReview: number
    pendingApproval: number
    recent: DashboardResource[]
  }
  generatedAt: string
}

export type DashboardResource = {
  id: string
  title: string
  status?: string | null
  resourceType: string
  href: string
  createdAt?: string | null
  updatedAt?: string | null
  dueAt?: string | null
}

type FirestoreDocument = FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>

type DashboardOrg = {
  id: string
  slug?: string
  name?: string
  displayName?: string
  companyName?: string
}

const ACTIVE_PROJECT_STATUSES = new Set(['active', 'in_progress', 'development', 'design', 'review', 'maintenance'])
const OPEN_TASK_STATUSES = new Set(['todo', 'in_progress'])
const ATTENTION_DOCUMENT_STATUSES = new Set(['client_review', 'changes_requested'])
const APPROVAL_DOCUMENT_STATUSES = new Set(['client_review'])

export function buildOrgDashboardLinks(slug: string): OrgDashboardDeepLinks {
  return {
    dashboard: `/admin/org/${slug}/dashboard`,
    projects: `/admin/org/${slug}/projects`,
    social: `/admin/org/${slug}/social`,
    socialQueue: `/admin/social/queue?org=${encodeURIComponent(slug)}`,
    socialCalendar: `/admin/social/calendar?org=${encodeURIComponent(slug)}`,
    tasks: `/admin/org/${slug}/projects`,
    inbox: `/admin/org/${slug}/messages`,
    approvals: `/admin/org/${slug}/social?status=pending_approval`,
    documents: `/admin/org/${slug}/documents`,
  }
}

export async function getOrganizationForDashboard(orgId: string): Promise<DashboardOrg | null> {
  const snap = await adminDb.collection('organizations').doc(orgId).get()
  if (!snap.exists) return null
  return { id: snap.id, ...(snap.data() as Omit<DashboardOrg, 'id'>) }
}

export async function buildOrgDashboardAggregate(org: DashboardOrg): Promise<OrgDashboardAggregate> {
  const slug = org.slug || org.id
  const links = buildOrgDashboardLinks(slug)

  const [projects, socialPosts, standaloneTasks, projectTasks, notifications, documents] = await Promise.all([
    fetchCollectionByOrg('projects', org.id),
    fetchCollectionByOrg('social_posts', org.id),
    fetchCollectionByOrg('tasks', org.id),
    fetchProjectTasksByOrg(org.id),
    fetchCollectionByOrg('notifications', org.id),
    fetchCollectionByOrg(CLIENT_DOCUMENTS_COLLECTION, org.id),
  ])

  const allTasks = [...standaloneTasks.map((doc) => ({ doc, projectId: doc.data().projectId as string | undefined })), ...projectTasks]

  const pendingSocialApprovals = socialPosts.filter((doc) => doc.data().status === 'pending_approval')
  const submittedExpenses = await fetchSubmittedExpenses(org.id)
  const pendingDocumentApprovals = documents.filter((doc) => APPROVAL_DOCUMENT_STATUSES.has(String(doc.data().status ?? '')))

  return {
    org: {
      id: org.id,
      slug,
      name: org.name || org.displayName || org.companyName || slug.replace(/-/g, ' '),
      links: {
        admin: `/admin/org/${slug}`,
        portal: '/portal/dashboard',
      },
    },
    deepLinks: links,
    projects: summarizeProjects(projects, links.projects),
    social: summarizeSocial(socialPosts, slug),
    tasks: summarizeTasks(allTasks, slug),
    inbox: summarizeInbox({
      notifications,
      pendingSocialApprovals,
      submittedExpenses,
      pendingDocumentApprovals,
      slug,
    }),
    documents: summarizeDocuments(documents, links.documents),
    generatedAt: new Date().toISOString(),
  }
}

async function fetchCollectionByOrg(collection: string, orgId: string): Promise<FirestoreDocument[]> {
  try {
    const snap = await adminDb.collection(collection).where('orgId', '==', orgId).get()
    return snap.docs.filter((doc) => doc.data().deleted !== true)
  } catch (error) {
    console.warn(`[org-dashboard:${collection}:skip]`, (error as Error).message)
    return []
  }
}

async function fetchProjectTasksByOrg(orgId: string): Promise<Array<{ doc: FirestoreDocument; projectId?: string }>> {
  try {
    const snap = await adminDb.collectionGroup('tasks').where('orgId', '==', orgId).get()
    return snap.docs
      .filter((doc) => doc.data().deleted !== true)
      .map((doc) => ({ doc, projectId: doc.ref.parent.parent?.id }))
  } catch (error) {
    console.warn('[org-dashboard:project-tasks:skip]', (error as Error).message)
    return []
  }
}

async function fetchSubmittedExpenses(orgId: string): Promise<FirestoreDocument[]> {
  try {
    const snap = await adminDb
      .collection('expenses')
      .where('orgId', '==', orgId)
      .where('status', '==', 'submitted')
      .get()
    return snap.docs.filter((doc) => doc.data().deleted !== true)
  } catch (error) {
    console.warn('[org-dashboard:expenses:skip]', (error as Error).message)
    return []
  }
}

function summarizeProjects(projects: FirestoreDocument[], projectsHref: string): OrgDashboardAggregate['projects'] {
  const sorted = sortDocsByTime(projects, 'updatedAt')
  return {
    total: projects.length,
    active: projects.filter((doc) => ACTIVE_PROJECT_STATUSES.has(String(doc.data().status ?? ''))).length,
    recent: sorted.slice(0, 6).map((doc) => {
      const data = doc.data()
      return {
        id: doc.id,
        title: String(data.name || data.title || 'Untitled project'),
        status: asNullableString(data.status),
        resourceType: 'project',
        href: `${projectsHref}/${doc.id}`,
        createdAt: toIsoOrNull(data.createdAt ?? data.startDate),
        updatedAt: toIsoOrNull(data.updatedAt ?? data.createdAt),
      }
    }),
  }
}

function summarizeSocial(posts: FirestoreDocument[], slug: string): OrgDashboardAggregate['social'] {
  const now = Date.now()
  const byStatus: Record<string, number> = {}
  const upcoming: DashboardResource[] = []

  for (const doc of posts) {
    const data = doc.data()
    const status = String(data.status || 'draft')
    byStatus[status] = (byStatus[status] ?? 0) + 1
    const scheduledAt = toIsoOrNull(data.scheduledAt ?? data.scheduledFor)
    if (status === 'scheduled' && scheduledAt && new Date(scheduledAt).getTime() >= now) {
      upcoming.push({
        id: doc.id,
        title: socialPostTitle(data),
        status,
        resourceType: 'social_post',
        href: `/admin/social/qa/${doc.id}?org=${encodeURIComponent(slug)}`,
        createdAt: toIsoOrNull(data.createdAt),
        updatedAt: toIsoOrNull(data.updatedAt),
        dueAt: scheduledAt,
      })
    }
  }

  upcoming.sort((a, b) => Date.parse(a.dueAt ?? '') - Date.parse(b.dueAt ?? ''))

  return {
    total: posts.length,
    byStatus,
    pendingApproval: byStatus.pending_approval ?? 0,
    scheduledUpcoming: upcoming.length,
    upcoming: upcoming.slice(0, 6),
  }
}

function summarizeTasks(
  tasks: Array<{ doc: FirestoreDocument; projectId?: string }>,
  slug: string,
): OrgDashboardAggregate['tasks'] {
  const now = Date.now()
  const byStatus: Record<string, number> = {}
  const byAgentStatus: Record<string, number> = {}
  let totalOpen = 0
  let overdue = 0
  const upcoming: DashboardResource[] = []

  for (const { doc, projectId } of tasks) {
    const data = doc.data()
    const status = String(data.status || data.columnId || 'todo')
    byStatus[status] = (byStatus[status] ?? 0) + 1
    if (typeof data.agentStatus === 'string') {
      byAgentStatus[data.agentStatus] = (byAgentStatus[data.agentStatus] ?? 0) + 1
    }
    const dueAt = toIsoOrNull(data.dueDate ?? data.targetDate)
    const isOpen = OPEN_TASK_STATUSES.has(status) || ['todo', 'in_progress'].includes(String(data.agentStatus ?? ''))
    if (isOpen) totalOpen++
    if (isOpen && dueAt && Date.parse(dueAt) < now) overdue++
    if (isOpen) {
      upcoming.push({
        id: doc.id,
        title: String(data.title || 'Untitled task'),
        status,
        resourceType: projectId ? 'project_task' : 'task',
        href: projectId ? `/admin/org/${slug}/projects/${projectId}?task=${doc.id}` : `/admin/tasks/${doc.id}`,
        createdAt: toIsoOrNull(data.createdAt),
        updatedAt: toIsoOrNull(data.updatedAt),
        dueAt,
      })
    }
  }

  upcoming.sort((a, b) => {
    const aTime = a.dueAt ? Date.parse(a.dueAt) : Number.MAX_SAFE_INTEGER
    const bTime = b.dueAt ? Date.parse(b.dueAt) : Number.MAX_SAFE_INTEGER
    return aTime - bTime
  })

  return {
    totalOpen,
    overdue,
    byStatus,
    byAgentStatus,
    upcoming: upcoming.slice(0, 8),
  }
}

function summarizeInbox(input: {
  notifications: FirestoreDocument[]
  pendingSocialApprovals: FirestoreDocument[]
  submittedExpenses: FirestoreDocument[]
  pendingDocumentApprovals: FirestoreDocument[]
  slug: string
}): OrgDashboardAggregate['inbox'] {
  const unreadNotifications = input.notifications.filter((doc) => doc.data().status !== 'read')
  const approvalCount = input.pendingSocialApprovals.length + input.submittedExpenses.length + input.pendingDocumentApprovals.length
  const recentNotifications = sortDocsByTime(unreadNotifications, 'createdAt').slice(0, 5).map((doc) => {
    const data = doc.data()
    return {
      id: doc.id,
      title: String(data.title || 'Notification'),
      status: asNullableString(data.status),
      resourceType: 'notification',
      href: typeof data.link === 'string' && data.link ? data.link : `/admin/org/${input.slug}/messages`,
      createdAt: toIsoOrNull(data.createdAt),
      updatedAt: toIsoOrNull(data.updatedAt),
    }
  })

  return {
    totalAttention: unreadNotifications.length + approvalCount,
    unreadNotifications: unreadNotifications.length,
    approvals: approvalCount,
    recent: recentNotifications,
  }
}

function summarizeDocuments(documents: FirestoreDocument[], documentsHref: string): OrgDashboardAggregate['documents'] {
  const byStatus: Record<string, number> = {}
  for (const doc of documents) {
    const status = String(doc.data().status || 'internal_draft')
    byStatus[status] = (byStatus[status] ?? 0) + 1
  }

  return {
    total: documents.length,
    byStatus,
    openReview: documents.filter((doc) => ATTENTION_DOCUMENT_STATUSES.has(String(doc.data().status ?? ''))).length,
    pendingApproval: documents.filter((doc) => APPROVAL_DOCUMENT_STATUSES.has(String(doc.data().status ?? ''))).length,
    recent: sortDocsByTime(documents, 'updatedAt').slice(0, 6).map((doc) => {
      const data = doc.data()
      return {
        id: doc.id,
        title: String(data.title || 'Untitled document'),
        status: asNullableString(data.status),
        resourceType: 'client_document',
        href: `${documentsHref}/${doc.id}`,
        createdAt: toIsoOrNull(data.createdAt),
        updatedAt: toIsoOrNull(data.updatedAt),
      }
    }),
  }
}

function sortDocsByTime(docs: FirestoreDocument[], preferredField: string): FirestoreDocument[] {
  return [...docs].sort((a, b) => {
    const aData = a.data()
    const bData = b.data()
    return toMillis(bData[preferredField] ?? bData.createdAt) - toMillis(aData[preferredField] ?? aData.createdAt)
  })
}

function socialPostTitle(data: FirebaseFirestore.DocumentData): string {
  const text = typeof data.content === 'string' ? data.content : data.content?.text
  if (typeof text === 'string' && text.trim()) return text.trim().slice(0, 80)
  const platforms = Array.isArray(data.platforms) ? data.platforms.join(', ') : data.platform
  return platforms ? `Scheduled post for ${platforms}` : 'Scheduled social post'
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function toMillis(value: unknown): number {
  const iso = toIsoOrNull(value)
  return iso ? Date.parse(iso) : 0
}

export function toIsoOrNull(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
  }
  if (typeof value === 'object') {
    const ts = value as Timestamp & { seconds?: number; _seconds?: number; toDate?: () => Date }
    if (typeof ts.toDate === 'function') return ts.toDate().toISOString()
    const seconds = ts.seconds ?? ts._seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString()
  }
  return null
}
