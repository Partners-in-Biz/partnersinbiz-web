/**
 * GET   /api/v1/projects/[projectId]  — get a single project
 * PATCH /api/v1/projects/[projectId]  — update a project
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { getProjectForUser } from '@/lib/projects/access'
import { logActivity } from '@/lib/activity/log'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }

const VALID_STATUSES = [
  'discovery',
  'design',
  'development',
  'review',
  'live',
  'maintenance',
] as const

type ProjectStatus = (typeof VALID_STATUSES)[number]

export const GET = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user)

  if (!access.ok) return apiError(access.error, access.status)
  const doc = access.doc
  return apiSuccess({ id: doc.id, ...doc.data() })
})

export const PATCH = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({}))
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)

  const updates: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() }

  if (body.name !== undefined) {
    if (!body.name.trim()) return apiError('name cannot be empty', 400)
    updates.name = body.name.trim()
  }

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status as ProjectStatus)) {
      return apiError('Invalid status', 400)
    }
    updates.status = body.status
  }

  if (body.archived !== undefined) {
    updates.archived = body.archived === true
    updates.archivedAt = body.archived === true ? FieldValue.serverTimestamp() : null
    updates.archivedBy = body.archived === true ? user.uid : null
  }

  if (body.description !== undefined) {
    updates.description = body.description
  }

  if (body.brief !== undefined) {
    updates.brief = body.brief
  }

  const orgId = access.doc.data()?.orgId as string | undefined
  await adminDb.collection('projects').doc(projectId).update(updates)

  if (orgId) {
    logActivity({
      orgId,
      type: 'project_updated',
      actorId: user.uid,
      actorName: user.uid,
      actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
      description: 'Updated project',
      entityId: projectId,
      entityType: 'project',
      entityTitle: (updates.name as string | undefined) ?? undefined,
    }).catch(() => {})
  }

  return apiSuccess({ id: projectId, ...updates })
})
