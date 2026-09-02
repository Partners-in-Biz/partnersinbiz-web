import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { actorFields, collectionFor, ensureBookStudioAccess, updateActorFields, validateBookStudioReferences } from './api'
import { findBookStudioRuntimeDispatchFields } from './hermes'
import { findLifecycleStateWriteAttempt } from './lifecycle'
import { BOOK_STUDIO_RESOURCES, BookStudioValidationError, bookStudioPatchDeletes, sanitizeBookStudioRecordInput, sanitizeBookStudioRecordPatch, serializeBookStudioRecord } from './sanitize'
import type { BookStudioResourceKey } from './types'
import {
  clientVisibilityFieldsForWrite,
  companyFieldsForWrite,
  recordVisibleForWorkScope,
  resolveWorkScopeFromRequest,
  resolveWorkScopeFromSearchParams,
  workScopeFieldsForWrite,
} from '@/lib/work-scope'

async function bookStudioScopeFields(
  resource: BookStudioResourceKey,
  body: Record<string, unknown>,
  data: Record<string, unknown>,
  req: Request,
  uid: string,
): Promise<Record<string, unknown>> {
  if (resource !== 'projects' && typeof data.projectId === 'string' && data.projectId) {
    const project = await adminDb.collection(collectionFor('projects')).doc(data.projectId).get()
    const projectData = project.exists ? project.data() ?? {} : {}
    return projectData.companyId ? companyFieldsForWrite(projectData.companyId) : {}
  }
  return workScopeFieldsForWrite(resolveWorkScopeFromRequest({ searchParams: new URL(req.url).searchParams, body, uid }))
}

export function isBookStudioResourceKey(value: string): value is BookStudioResourceKey {
  return Object.prototype.hasOwnProperty.call(BOOK_STUDIO_RESOURCES, value)
}

function runtimeDispatchBlocked(body: Record<string, unknown>) {
  const runtimeDispatchFields = findBookStudioRuntimeDispatchFields(body)
  if (!runtimeDispatchFields.length) return null
  return Response.json({
    success: false,
    error: 'Book Studio Hermes runtime dispatch is not enabled in V1',
    module: 'bookStudio',
    runtimeDispatchAllowed: false,
    blockedFields: runtimeDispatchFields,
  }, { status: 403 })
}

function lifecycleStateWriteBlocked(body: Record<string, unknown>) {
  if (!findLifecycleStateWriteAttempt(body)) return null
  return Response.json({
    success: false,
    error: 'lifecycleState can only be changed via the /transition endpoint',
  }, { status: 403 })
}

export function createBookStudioResourceHandlers(resource: BookStudioResourceKey) {
  const collectionName = collectionFor(resource)

  const GET = withAuth('admin', async (req, user) => {
    const access = await ensureBookStudioAccess(req, user)
    if (access.error) return access.error

    const workScope = resolveWorkScopeFromSearchParams(new URL(req.url).searchParams, user.uid)
    const snap = await adminDb.collection(collectionName).where('orgId', '==', access.orgId).get()
    const records = snap.docs
      .filter((doc) => recordVisibleForWorkScope(doc.data() as Record<string, unknown>, workScope))
      .map((doc) => serializeBookStudioRecord(doc.id, doc.data()))
      .filter((record) => record.deleted !== true)

    return apiSuccess({ resource, records })
  })

  const POST = withAuth('admin', async (req, user) => {
    let body: Record<string, unknown>
    try {
      body = await req.json() as Record<string, unknown>
    } catch {
      const access = await ensureBookStudioAccess(req, user, undefined, 'write')
      if (access.error) return access.error
      return Response.json({ success: false, error: 'Malformed JSON body' }, { status: 400 })
    }
    const access = await ensureBookStudioAccess(req, user, body, 'write')
    if (access.error) return access.error

    const dispatchBlocked = runtimeDispatchBlocked(body)
    if (dispatchBlocked) return dispatchBlocked

    let data
    try {
      data = sanitizeBookStudioRecordInput(resource, body, access.orgId)
    } catch (error) {
      if (error instanceof BookStudioValidationError) return apiError(error.message, error.status)
      throw error
    }
    const referenceError = await validateBookStudioReferences(access.orgId, data)
    if (referenceError) return referenceError

    const ref = await adminDb.collection(collectionName).add({
      ...data,
      ...(await bookStudioScopeFields(resource, body, data as Record<string, unknown>, req, user.uid)),
      ...clientVisibilityFieldsForWrite(body.clientVisibility),
      ...actorFields(user),
    })

    return apiSuccess({ id: ref.id, resource }, 201)
  })

  return { GET, POST }
}

type BookStudioRecordRouteContext = { params: Promise<{ resource: string; id: string }> }

export function createBookStudioRecordHandlers() {
  const PATCH = withAuth('admin', async (req, user, context: BookStudioRecordRouteContext) => {
    const { resource: resourceParam, id } = await context.params
    if (!isBookStudioResourceKey(resourceParam)) return apiError('Unknown Book Studio resource', 404)
    const resource = resourceParam

    let body: Record<string, unknown>
    try {
      body = await req.json() as Record<string, unknown>
    } catch {
      const access = await ensureBookStudioAccess(req, user, undefined, 'write')
      if (access.error) return access.error
      return apiError('Malformed JSON body', 400)
    }
    const access = await ensureBookStudioAccess(req, user, body, 'write')
    if (access.error) return access.error

    const dispatchBlocked = runtimeDispatchBlocked(body)
    if (dispatchBlocked) return dispatchBlocked

    const lifecycleBlocked = lifecycleStateWriteBlocked(body)
    if (lifecycleBlocked) return lifecycleBlocked

    const docRef = adminDb.collection(collectionFor(resource)).doc(id)
    const snap = await docRef.get()
    const existing = snap.exists ? snap.data() ?? {} : null
    // Cross-org records must be indistinguishable from missing ones.
    if (!existing || existing.orgId !== access.orgId || existing.deleted === true) {
      return apiError(`${BOOK_STUDIO_RESOURCES[resource].label} not found`, 404)
    }

    let patch: Record<string, unknown>
    try {
      // orgId/projectId are stripped inside the patch sanitizer — a record can
      // never be moved to another organisation or project through PATCH.
      patch = sanitizeBookStudioRecordPatch(resource, body, access.orgId)
    } catch (error) {
      if (error instanceof BookStudioValidationError) return apiError(error.message, error.status)
      throw error
    }

    const referenceError = await validateBookStudioReferences(access.orgId, patch)
    if (referenceError) return referenceError

    if (body.deleted === true) patch.deleted = true

    // update() replaces each top-level key wholesale (no deep-merge of nested
    // maps), so composite fields like puzzle/packageManifest never retain
    // stale nested data from the previous value — unlike set(..., {merge:true}).
    await docRef.update({
      ...patch,
      ...('clientVisibility' in body ? clientVisibilityFieldsForWrite(body.clientVisibility) : {}),
      ...bookStudioPatchDeletes(resource, body, () => FieldValue.delete()),
      ...updateActorFields(user),
    })

    return apiSuccess({ id, resource, updated: true })
  })

  return { PATCH }
}
