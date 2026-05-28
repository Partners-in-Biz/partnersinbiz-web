import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { getProjectForUser } from '@/lib/projects/access'
import {
  buildProjectHealth,
  canProjectRole,
  filterInternalItemsForProjectAccess,
} from '@/lib/projects/collaboration'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }
type SuiteType = 'milestone' | 'approval' | 'risk' | 'decision'

const COLLECTION_BY_TYPE: Record<SuiteType, string> = {
  milestone: 'milestones',
  approval: 'approvals',
  risk: 'risks',
  decision: 'decisions',
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function listSubcollection(projectId: string, collectionName: string) {
  const snap = await adminDb.collection('projects').doc(projectId).collection(collectionName).get()
  return snap.docs.map((doc: { id: string; data: () => Record<string, unknown> }) => ({ id: doc.id, ...doc.data() }))
}

export const GET = withAuth('client', async (_req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)

  const [tasksRaw, milestonesRaw, approvalsRaw, risksRaw, decisionsRaw] = await Promise.all([
    listSubcollection(projectId, 'tasks'),
    listSubcollection(projectId, 'milestones'),
    listSubcollection(projectId, 'approvals'),
    listSubcollection(projectId, 'risks'),
    listSubcollection(projectId, 'decisions'),
  ])
  const canViewInternal = access.projectAccess?.canViewInternal === true
  const tasks = filterInternalItemsForProjectAccess(tasksRaw, canViewInternal)
  const milestones = filterInternalItemsForProjectAccess(milestonesRaw, canViewInternal)
  const approvals = filterInternalItemsForProjectAccess(approvalsRaw, canViewInternal)
  const risks = filterInternalItemsForProjectAccess(risksRaw, canViewInternal)
  const decisions = filterInternalItemsForProjectAccess(decisionsRaw, canViewInternal)

  return apiSuccess({
    health: buildProjectHealth({ tasks, milestones, approvals }),
    tasks,
    milestones,
    approvals,
    risks,
    decisions,
  })
})

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', 'write')) {
    return apiError('Project contributor access is required', 403)
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const type = cleanString(body.type) as SuiteType
  const collectionName = COLLECTION_BY_TYPE[type]
  if (!collectionName) return apiError('type must be one of: milestone, approval, risk, decision', 400)

  const title = cleanString(body.title)
  if (!title) return apiError('title is required', 400)

  const record: Record<string, unknown> = {
    type,
    title,
    description: cleanString(body.description),
    status: cleanString(body.status) || (type === 'risk' ? 'open' : type === 'decision' ? 'proposed' : 'active'),
    ownerUid: cleanString(body.ownerUid) || user.uid,
    dueDate: cleanString(body.dueDate) || null,
    severity: cleanString(body.severity) || undefined,
    reviewerIds: Array.isArray(body.reviewerIds)
      ? body.reviewerIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [],
    linkedTaskIds: Array.isArray(body.linkedTaskIds)
      ? body.linkedTaskIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [],
    internalOnly: body.internalOnly === true,
    createdBy: user.uid,
    updatedBy: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
  const toWrite = Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))
  const ref = await adminDb.collection('projects').doc(projectId).collection(collectionName).add(toWrite)
  return apiSuccess({ id: ref.id, ...toWrite }, 201)
})
