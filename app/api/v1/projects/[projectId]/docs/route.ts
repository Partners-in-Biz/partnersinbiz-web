/**
 * GET  /api/v1/projects/[projectId]/docs  — list all docs for a project
 * POST /api/v1/projects/[projectId]/docs  — create a doc
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import type { ClientDocument } from '@/lib/client-documents/types'
import { getProjectForUser } from '@/lib/projects/access'
import { canProjectRole, filterProjectItemsForAccess } from '@/lib/projects/collaboration'
import { planningContextMutationTransition } from '@/lib/projects/planningDiscoveryStore'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }

export const GET = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user)
  if (!access.ok) return apiError(access.error, access.status)

  const legacySnapshot = await adminDb
    .collection('projects')
    .doc(projectId)
    .collection('docs')
    .orderBy('createdAt', 'desc')
    .get()
  const linkedSnapshot = await adminDb
    .collection(CLIENT_DOCUMENTS_COLLECTION)
    .where('linked.projectId', '==', projectId)
    .get()

  const legacyDocs = legacySnapshot.docs.map(doc => ({ id: doc.id, source: 'legacy_project_docs', ...doc.data() }))
  const clientDocuments = linkedSnapshot.docs
    .map(doc => ({ id: doc.id, source: 'client_documents', ...(doc.data() as Partial<ClientDocument>) }))
    .filter(doc => doc.deleted !== true)

  return apiSuccess(filterProjectItemsForAccess(
    [...clientDocuments, ...legacyDocs],
    { projectAccess: access.projectAccess, user },
  ))
})

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({}))
  const access = await getProjectForUser(projectId, user, undefined, { action: 'project.write' })
  if (!access.ok) return apiError(access.error, access.status)
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', 'write')) {
    return apiError('Project contributor access is required to create documents', 403)
  }
  if ((access.projectAccess?.crossOrgGrant?.items.length ?? 0) > 0) {
    return apiError('Item-scoped cross-organisation grants cannot create unscoped project documents', 403)
  }

  if (!body.title?.trim()) return apiError('title is required', 400)
  if (!body.content) return apiError('content is required', 400)
  if (!['brief', 'requirements', 'notes', 'reference'].includes(body.type)) {
    return apiError('type must be one of: brief, requirements, notes, reference', 400)
  }

  const doc = {
    title: body.title.trim(),
    content: body.content,
    type: body.type,
    internalOnly: body.internalOnly === true,
    createdBy: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  const projectRef = adminDb.collection('projects').doc(projectId)
  const ref = projectRef.collection('docs').doc()
  const eventRef = projectRef.collection('planningDiscoveryEvents').doc()
  const mutation = await adminDb.runTransaction(async (tx) => {
    const liveSnapshot = await tx.get(projectRef)
    if (!liveSnapshot.exists) return { ok: false as const, status: 404, error: 'Project not found' }
    const liveProject = (liveSnapshot.data() ?? {}) as Record<string, unknown>
    const transition = planningContextMutationTransition(liveProject, {
      uid: user.uid,
      now: new Date().toISOString(),
      reason: 'Project document created',
    })
    if (transition.state) {
      tx.update(projectRef, {
        planningDiscovery: transition.state,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
    if (transition.event) {
      tx.set(eventRef, {
        ...transition.event,
        projectId,
        orgId: liveProject.orgId ?? null,
        schemaVersion: 1,
      })
    }
    if (!transition.allowed) {
      return { ok: false as const, status: 409, error: transition.blocker.message, details: transition.blocker }
    }
    tx.set(ref, doc)
    return { ok: true as const }
  })
  if (!mutation.ok) return apiError(mutation.error, mutation.status, 'details' in mutation ? mutation.details : undefined)

  return apiSuccess({ id: ref.id, ...doc, migrationTarget: 'client_documents' }, 201)
})
