/**
 * GET /api/v1/admin/agent-tasks
 *
 * Unified list of all agent-assigned tasks across both task systems
 * (project-nested under projects/{id}/tasks and standalone /tasks), filtered
 * by orgId. Resolves project names server-side so cards can show the
 * project link without an extra round-trip.
 *
 * Query params:
 *   - orgId    (preferred)         OR
 *   - orgSlug  (resolved server-side)
 *   - assigneeAgentId   optional   filter to a single agent
 *
 * Auth: admin OR ai role.
 */

import { NextRequest } from 'next/server'
import { Query, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { VALID_AGENT_IDS, type AgentId, type AgentStatus } from '@/lib/tasks/types'
import { matchesAgentBoardView, type AgentBoardOperationalView } from '@/lib/agent-board/filters'

export const dynamic = 'force-dynamic'

type AgentTaskCard = {
  id: string
  source: 'project' | 'standalone'
  orgId: string
  title: string
  projectId: string | null
  projectName: string | null
  assigneeAgentId: AgentId | null
  agentStatus: AgentStatus | null
  agentInputSpec: string | null
  agentOutputSummary: string | null
  priority: string | null
  tags: string[]
  labels: string[]
  columnId: string | null
  dependsOn: string[]
  dependencyStatuses: Record<string, string | null>
  linkedDocumentId: string | null
  linkedDocumentIds: string[]
  linkedDocuments: Array<string | { id?: string | null; ref?: string | null; type?: string | null }>
  clientDocumentId: string | null
  documentId: string | null
  sourceOrigin: string | null
  origin: string | null
  originType: string | null
  createdBy: string | null
  clientOrgId: string | null
  updatedAt: string | null
  createdAt: string | null
  href: string
}

function tsToMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Timestamp) return value.toMillis()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    try { return (value as { toDate: () => Date }).toDate().getTime() } catch { return 0 }
  }
  if (typeof value === 'object' && value !== null) {
    const seconds = (value as { seconds?: unknown; _seconds?: unknown }).seconds ?? (value as { _seconds?: unknown })._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  if (typeof value === 'string') {
    const millis = Date.parse(value)
    return Number.isFinite(millis) ? millis : 0
  }
  return 0
}

function tsToIso(value: unknown): string | null {
  const millis = tsToMillis(value)
  if (millis > 0) return new Date(millis).toISOString()
  if (typeof value === 'string') return value
  return null
}

const OPERATIONAL_VIEWS: AgentBoardOperationalView[] = [
  'all',
  'blocked',
  'awaiting-input',
  'document-linked',
  'dependency-blocked',
  'cron-origin',
  'cross-client',
]

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function stringRecord(value: unknown): Record<string, string | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key.length > 0)
      .map(([key, val]) => [key, nullableString(val)]),
  )
}

function linkedDocuments(value: unknown): AgentTaskCard['linkedDocuments'] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string | { id?: string | null; ref?: string | null; type?: string | null } => {
    if (typeof item === 'string') return item.length > 0
    return Boolean(item && typeof item === 'object')
  })
}

export const GET = withAuth('admin', async (req: NextRequest, user) => {
  const { searchParams } = new URL(req.url)
  let orgId = searchParams.get('orgId')?.trim() ?? null
  const orgSlug = searchParams.get('orgSlug')?.trim() ?? null
  const agentFilter = searchParams.get('assigneeAgentId')?.trim() as AgentId | null
  const operationalView = (searchParams.get('view')?.trim() ?? 'all') as AgentBoardOperationalView

  if (!OPERATIONAL_VIEWS.includes(operationalView)) {
    return apiError(`Invalid view; expected one of ${OPERATIONAL_VIEWS.join(' | ')}`, 400)
  }

  const crossClientScope = !orgId && !orgSlug
  if (crossClientScope && !isSuperAdmin(user)) {
    return apiError('orgId or orgSlug query param is required', 400)
  }

  if (!crossClientScope && !orgId && !orgSlug) {
    return apiError('orgId or orgSlug query param is required', 400)
  }

  // Resolve slug → orgId if needed.
  let orgName: string | null = null
  let orgSlugResolved = orgSlug
  if (!orgId && orgSlug) {
    const snap = await adminDb.collection('organizations').where('slug', '==', orgSlug).limit(1).get()
    if (snap.empty) return apiError('Organisation not found', 404)
    const d = snap.docs[0]
    orgId = d.id
    orgName = (d.data().name as string) ?? null
  } else if (orgId) {
    const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
    if (orgDoc.exists) {
      orgName = (orgDoc.data()?.name as string) ?? null
      orgSlugResolved = (orgDoc.data()?.slug as string) ?? orgSlugResolved
    }
  }
  if (!crossClientScope && !orgId) return apiError('Could not resolve org', 404)

  // Validate agent filter if supplied.
  if (agentFilter && !VALID_AGENT_IDS.includes(agentFilter)) {
    return apiError(`Invalid assigneeAgentId; expected one of ${VALID_AGENT_IDS.join(' | ')}`, 400)
  }

  // CollectionGroup query — returns both project-nested AND standalone tasks
  // since both live in collections named "tasks". Filter by orgId + agent.
  let q: Query = adminDb.collectionGroup('tasks')
  if (orgId) q = q.where('orgId', '==', orgId)
  if (agentFilter) {
    q = q.where('assigneeAgentId', '==', agentFilter)
  } else {
    q = q.where('assigneeAgentId', 'in', VALID_AGENT_IDS)
  }
  // Avoid a cross-client composite Firestore index requirement for the mission-control dashboard.
  // Single-org boards can use the indexed ordered query; cross-client reads sort the bounded result in memory.
  const snap = orgId
    ? await q.orderBy('updatedAt', 'desc').limit(500).get()
    : await q.limit(500).get()
  const taskDocs = [...snap.docs].sort((a, b) => tsToMillis((b.data() as Record<string, unknown>).updatedAt) - tsToMillis((a.data() as Record<string, unknown>).updatedAt))

  // Collect unique projectIds to resolve names in one batch.
  const projectIds = new Set<string>()
  taskDocs.forEach((d) => {
    const data = d.data() as Record<string, unknown>
    if (typeof data.projectId === 'string' && data.projectId) projectIds.add(data.projectId)
    // Project-nested tasks: parent path is projects/{id}/tasks
    const parentDoc = d.ref.parent.parent
    if (parentDoc && parentDoc.parent.id === 'projects') projectIds.add(parentDoc.id)
  })

  const projectNames = new Map<string, string>()
  const projectClientOrgIds = new Map<string, string | null>()
  if (projectIds.size > 0) {
    const refs = Array.from(projectIds).map((id) => adminDb.collection('projects').doc(id))
    const projDocs = await adminDb.getAll(...refs)
    projDocs.forEach((p) => {
      if (p.exists) {
        const name = (p.data()?.name as string) ?? null
        if (name) projectNames.set(p.id, name)
        projectClientOrgIds.set(p.id, nullableString(p.data()?.clientOrgId))
      }
    })
  }

  const slug = orgSlugResolved ?? orgId
  const orgNames = new Map<string, string>()
  const orgSlugs = new Map<string, string>()
  if (crossClientScope) {
    const orgIds = Array.from(new Set(taskDocs.map((d) => nullableString((d.data() as Record<string, unknown>).orgId)).filter((id): id is string => Boolean(id))))
    if (orgIds.length > 0) {
      const orgDocs = await adminDb.getAll(...orgIds.map((id) => adminDb.collection('organizations').doc(id)))
      orgDocs.forEach((org) => {
        if (org.exists) {
          orgNames.set(org.id, nullableString(org.data()?.name) ?? org.id)
          const slug = nullableString(org.data()?.slug)
          if (slug) orgSlugs.set(org.id, slug)
        }
      })
    }
  }

  const cards = taskDocs.map<AgentTaskCard>((d) => {
    const data = d.data() as Record<string, unknown>
    const parentDoc = d.ref.parent.parent
    const isProjectNested = !!parentDoc && parentDoc.parent.id === 'projects'
    const projectId = isProjectNested
      ? parentDoc!.id
      : (typeof data.projectId === 'string' ? data.projectId : null)
    const projectName = projectId ? projectNames.get(projectId) ?? null : null

    const ai = data.agentInput as { spec?: unknown } | undefined
    const ao = data.agentOutput as { summary?: unknown } | undefined
    const labels = Array.isArray(data.labels) ? data.labels.filter((l): l is string => typeof l === 'string') : []
    const tags = Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string') : labels

    const cardOrgId = nullableString(data.orgId) ?? orgId!
    const cardSlug = (cardOrgId ? orgSlugs.get(cardOrgId) : null) ?? slug ?? cardOrgId
    const href = isProjectNested && projectId
      ? `/admin/org/${cardSlug}/projects/${projectId}?task=${d.id}`
      : `/admin/org/${cardSlug}/agent/board?task=${d.id}`

    return {
      id: d.id,
      source: isProjectNested ? 'project' : 'standalone',
      orgId: cardOrgId,
      title: (data.title as string) ?? '(untitled)',
      projectId,
      projectName,
      assigneeAgentId: (data.assigneeAgentId as AgentId) ?? null,
      agentStatus: (data.agentStatus as AgentStatus) ?? null,
      agentInputSpec: typeof ai?.spec === 'string' ? ai.spec : null,
      agentOutputSummary: typeof ao?.summary === 'string' ? ao.summary : null,
      priority: typeof data.priority === 'string' ? data.priority : null,
      tags,
      labels,
      columnId: nullableString(data.columnId),
      dependsOn: stringArray(data.dependsOn),
      dependencyStatuses: stringRecord(data.dependencyStatuses),
      linkedDocumentId: nullableString(data.linkedDocumentId),
      linkedDocumentIds: stringArray(data.linkedDocumentIds),
      linkedDocuments: linkedDocuments(data.linkedDocuments),
      clientDocumentId: nullableString(data.clientDocumentId),
      documentId: nullableString(data.documentId),
      sourceOrigin: nullableString(data.sourceOrigin),
      origin: nullableString(data.origin),
      originType: nullableString(data.originType),
      createdBy: nullableString(data.createdBy),
      clientOrgId: nullableString(data.clientOrgId) ?? (projectId ? projectClientOrgIds.get(projectId) ?? null : null),
      updatedAt: tsToIso(data.updatedAt),
      createdAt: tsToIso(data.createdAt),
      href,
    }
  }).filter((card) => matchesAgentBoardView(card, operationalView))

  // Group counts by status for the page header.
  const STATUS_ORDER: AgentStatus[] = ['pending', 'picked-up', 'in-progress', 'awaiting-input', 'done', 'blocked']
  const byStatus: Record<string, number> = {}
  for (const s of STATUS_ORDER) byStatus[s] = 0
  byStatus.unstarted = 0
  for (const c of cards) {
    const k = c.agentStatus && STATUS_ORDER.includes(c.agentStatus) ? c.agentStatus : 'unstarted'
    byStatus[k] = (byStatus[k] ?? 0) + 1
  }

  return apiSuccess({
    orgId,
    orgSlug: orgSlugResolved,
    orgName,
    orgNames: Object.fromEntries(orgNames),
    operationalView,
    total: cards.length,
    byStatus,
    statusOrder: STATUS_ORDER,
    cards,
  })
})
