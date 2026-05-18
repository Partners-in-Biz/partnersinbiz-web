/**
 * GET  /api/v1/projects  — list projects (admin all/scoped, client own org)
 * POST /api/v1/projects  — create a new project (admin selected org, client own org)
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import type * as FirebaseFirestore from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { logActivity } from '@/lib/activity/log'
import { canAccessOrg, restrictedAdminOrgIds } from '@/lib/api/platformAdmin'

const VALID_STATUSES = [
  'discovery',
  'design',
  'development',
  'review',
  'live',
  'maintenance',
] as const

type ProjectStatus = (typeof VALID_STATUSES)[number]

type ProjectListItem = {
  id: string
  createdAt?: unknown
  [key: string]: unknown
}

function createdAtMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const timestamp = value as {
      toMillis?: () => number
      seconds?: number
      _seconds?: number
    }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const orgSlug = searchParams.get('orgSlug')

  let query: FirebaseFirestore.Query = adminDb.collection('projects')

  if (user.role === 'client') {
    if (!user.orgId) return apiSuccess([])
    query = query.where('orgId', '==', user.orgId)
  }

  // If orgSlug is provided, look up org by slug and filter by orgId
  if (user.role !== 'client' && orgSlug) {
    const orgSnapshot = await adminDb
      .collection('organizations')
      .where('slug', '==', orgSlug)
      .limit(1)
      .get()

    if (orgSnapshot.empty) {
      return apiSuccess([])
    }

    const orgId = orgSnapshot.docs[0].id
    if (!canAccessOrg(user, orgId)) {
      return apiError('Forbidden', 403)
    }
    query = query.where('orgId', '==', orgId)
  } else if (user.role === 'admin') {
    const allowedOrgIds = restrictedAdminOrgIds(user)
    if (allowedOrgIds.length > 0) query = query.where('orgId', 'in', allowedOrgIds.slice(0, 30))
  }

  const snapshot = await query.get()

  const projects: ProjectListItem[] = snapshot.docs
    .map((doc): ProjectListItem => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt))

  return apiSuccess(projects)
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json()

  if (!body.name?.trim()) return apiError('Name is required')
  if (body.status && !VALID_STATUSES.includes(body.status as ProjectStatus)) {
    return apiError('Invalid status')
  }

  let orgId = user.role === 'client' ? user.orgId ?? '' : body.orgId?.trim() ?? ''

  // If orgSlug is provided, look up the org by slug and get its ID
  if (user.role !== 'client' && !orgId && body.orgSlug?.trim()) {
    const orgSnapshot = await adminDb
      .collection('organizations')
      .where('slug', '==', body.orgSlug.trim())
      .limit(1)
      .get()

    if (!orgSnapshot.empty) {
      orgId = orgSnapshot.docs[0].id
    } else {
      return apiError('Organization not found', 404)
    }
  }

  if (!orgId) return apiError('Organization is required', 400)
  if (!canAccessOrg(user, orgId)) {
    return apiError('Forbidden', 403)
  }

  const clientId = body.clientId?.trim() || orgId

  const name = body.name.trim()
  const docRef = await adminDb.collection('projects').add({
    name,
    orgId,
    clientId,
    clientOrgId: body.clientOrgId?.trim() || clientId || null,
    description: body.description?.trim() ?? '',
    brief: body.brief?.trim() ?? '',
    status: (body.status as ProjectStatus) ?? 'discovery',
    startDate: FieldValue.serverTimestamp(),
    targetDate: body.targetDate ?? null,
    createdBy: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  logActivity({
    orgId,
    type: 'project_created',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: `Created project: "${name}"`,
    entityId: docRef.id,
    entityType: 'project',
    entityTitle: name,
  }).catch(() => {})

  return apiSuccess({ id: docRef.id }, 201)
})

export const DELETE = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (!id) return apiError('Project ID is required', 400)

  const docRef = adminDb.collection('projects').doc(id)
  const snap = await docRef.get()
  if (!snap.exists) return apiError('Project not found', 404)
  const orgId = snap.data()?.orgId
  if (!canAccessOrg(user, orgId)) {
    return apiError('Forbidden', 403)
  }

  await docRef.delete()

  logActivity({
    orgId: typeof orgId === 'string' ? orgId : String(orgId ?? ''),
    type: 'project_deleted',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: 'Deleted project',
    entityId: id,
    entityType: 'project',
  }).catch(() => {})

  return apiSuccess({ id })
})
