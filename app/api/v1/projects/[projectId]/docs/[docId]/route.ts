/**
 * GET    /api/v1/projects/[projectId]/docs/[docId]  — get a single doc
 * PATCH  /api/v1/projects/[projectId]/docs/[docId]  — update a doc
 * DELETE /api/v1/projects/[projectId]/docs/[docId]  — delete a doc
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { documentLinksTo } from '@/lib/client-documents/links'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import type { ClientDocument } from '@/lib/client-documents/types'
import { getProjectForUser } from '@/lib/projects/access'
import { canProjectRole, filterProjectItemsForAccess } from '@/lib/projects/collaboration'
import { planningContextMutationTransition } from '@/lib/projects/planningDiscoveryStore'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string; docId: string }> }

function documentIsVisible(
  docId: string,
  document: Record<string, unknown>,
  access: Extract<Awaited<ReturnType<typeof getProjectForUser>>, { ok: true }>,
  user: Parameters<typeof getProjectForUser>[1],
): boolean {
  return filterProjectItemsForAccess([{ id: docId, ...document }], {
    projectAccess: access.projectAccess,
    user,
  }).length === 1
}

export const GET = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId, docId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user, undefined, { action: 'project.read', item: docId })
  if (!access.ok) return apiError(access.error, access.status)

  const doc = await adminDb
    .collection('projects')
    .doc(projectId)
    .collection('docs')
    .doc(docId)
    .get()

  if (doc.exists) {
    const data = doc.data() ?? {}
    if (!documentIsVisible(docId, data, access, user)) return apiError('Document not found', 404)
    return apiSuccess({ id: doc.id, source: 'legacy_project_docs', ...data })
  }

  const clientDocument = await adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(docId).get()
  if (!clientDocument.exists || clientDocument.data()?.deleted === true) return apiError('Document not found', 404)

  const data = clientDocument.data() as Omit<ClientDocument, 'id'>
  if (!documentLinksTo('projectId', projectId, data) || !documentIsVisible(docId, data, access, user)) {
    return apiError('Document not found', 404)
  }

  return apiSuccess({ ...data, id: clientDocument.id, source: 'client_documents' })
})

export const PATCH = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId, docId } = await (ctx as RouteContext).params
  const body = await req.json().catch(() => ({}))
  const access = await getProjectForUser(projectId, user, undefined, { action: 'project.write', item: docId })
  if (!access.ok) return apiError(access.error, access.status)
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', 'write')) {
    return apiError('Project contributor access is required to update documents', 403)
  }

  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp(), updatedBy: user.uid }

  if (body.title !== undefined) {
    if (!body.title.trim()) return apiError('title cannot be empty', 400)
    updates.title = body.title.trim()
  }

  if (body.content !== undefined) {
    if (!body.content) return apiError('content cannot be empty', 400)
    updates.content = body.content
  }

  if (body.type !== undefined) {
    if (!['brief', 'requirements', 'notes', 'reference'].includes(body.type)) {
      return apiError('type must be one of: brief, requirements, notes, reference', 400)
    }
    updates.type = body.type
  }

  const projectRef = adminDb.collection('projects').doc(projectId)
  const docRef = projectRef.collection('docs').doc(docId)
  const eventRef = projectRef.collection('planningDiscoveryEvents').doc()
  const mutation = await adminDb.runTransaction(async (tx) => {
    const [liveProjectSnapshot, liveDocSnapshot] = await Promise.all([tx.get(projectRef), tx.get(docRef)])
    if (!liveProjectSnapshot.exists) return { ok: false as const, status: 404, error: 'Project not found' }
    if (!liveDocSnapshot.exists) return { ok: false as const, status: 404, error: 'Document not found' }
    const liveDocument = liveDocSnapshot.data() ?? {}
    if (!documentIsVisible(docId, liveDocument, access, user)) {
      return { ok: false as const, status: 404, error: 'Document not found' }
    }
    const liveProject = (liveProjectSnapshot.data() ?? {}) as Record<string, unknown>
    const transition = planningContextMutationTransition(liveProject, {
      uid: user.uid,
      now: new Date().toISOString(),
      reason: 'Project document materially changed',
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
    tx.update(docRef, updates)
    return { ok: true as const }
  })
  if (!mutation.ok) return apiError(mutation.error, mutation.status, 'details' in mutation ? mutation.details : undefined)

  return apiSuccess({ id: docId, ...updates })
})

export const DELETE = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { projectId, docId } = await (ctx as RouteContext).params
  const access = await getProjectForUser(projectId, user, undefined, { action: 'project.write', item: docId })
  if (!access.ok) return apiError(access.error, access.status)
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', 'write')) {
    return apiError('Project contributor access is required to delete documents', 403)
  }
  const projectRef = adminDb.collection('projects').doc(projectId)
  const docRef = projectRef.collection('docs').doc(docId)
  const eventRef = projectRef.collection('planningDiscoveryEvents').doc()
  const mutation = await adminDb.runTransaction(async (tx) => {
    const [liveProjectSnapshot, liveDocSnapshot] = await Promise.all([tx.get(projectRef), tx.get(docRef)])
    if (!liveProjectSnapshot.exists) return { ok: false as const, status: 404, error: 'Project not found' }
    if (!liveDocSnapshot.exists) return { ok: false as const, status: 404, error: 'Document not found' }
    const liveDocument = liveDocSnapshot.data() ?? {}
    if (!documentIsVisible(docId, liveDocument, access, user)) {
      return { ok: false as const, status: 404, error: 'Document not found' }
    }
    const liveProject = (liveProjectSnapshot.data() ?? {}) as Record<string, unknown>
    const transition = planningContextMutationTransition(liveProject, {
      uid: user.uid,
      now: new Date().toISOString(),
      reason: 'Project document deleted',
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
    tx.delete(docRef)
    return { ok: true as const }
  })
  if (!mutation.ok) return apiError(mutation.error, mutation.status, 'details' in mutation ? mutation.details : undefined)

  return apiSuccess({ success: true })
})
