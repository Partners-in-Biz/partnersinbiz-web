import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import {
  portalActionForRequest,
  resolveBookStudioCapabilities,
} from '@/lib/book-studio/capabilities'
import { collectionFor, validateBookStudioReferences } from '@/lib/book-studio/api'
import { isBookStudioResourceKey } from '@/lib/book-studio/routes'
import { findBookStudioRuntimeDispatchFields } from '@/lib/book-studio/hermes'
import { findLifecycleStateWriteAttempt } from '@/lib/book-studio/lifecycle'
import {
  BOOK_STUDIO_RESOURCES,
  BookStudioValidationError,
  bookStudioPatchDeletes,
  sanitizeBookStudioRecordPatch,
} from '@/lib/book-studio/sanitize'
import { portalBookStudioGuard } from '@/lib/book-studio/portal'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ resource: string; id: string }> }

export const PATCH = withPortalAuthAndRole('viewer', async (req: NextRequest, uid: string, orgId: string, role, context: Ctx) => {
  const { resource, id } = await context.params
  if (!isBookStudioResourceKey(resource)) return apiError('Unknown Book Studio resource', 404)

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return apiError('Malformed JSON body', 400)
  }

  const requiredAction = portalActionForRequest('PATCH', resource, body)
  if (!requiredAction) return apiError('Unknown Book Studio resource', 404)

  const guard = await portalBookStudioGuard(orgId)
  if (guard.error) return guard.error
  const caps = resolveBookStudioCapabilities(guard.settings, role, false)
  if (!caps[requiredAction]) return apiError('Your role does not have access to this Book Studio action', 403)

  const dispatchFields = findBookStudioRuntimeDispatchFields(body)
  if (dispatchFields.length) return apiError('Book Studio Hermes runtime dispatch is not enabled in V1', 403)

  if (findLifecycleStateWriteAttempt(body)) {
    return apiError('lifecycleState can only be changed via the /transition endpoint', 403)
  }

  const docRef = adminDb.collection(collectionFor(resource)).doc(id)
  const snap = await docRef.get()
  const existing = snap.exists ? snap.data() ?? {} : null
  if (!existing || existing.orgId !== orgId || existing.deleted === true) {
    return apiError(`${BOOK_STUDIO_RESOURCES[resource].label} not found`, 404)
  }

  let patch: Record<string, unknown>
  try {
    patch = sanitizeBookStudioRecordPatch(resource, body, orgId)
  } catch (error) {
    if (error instanceof BookStudioValidationError) return apiError(error.message, error.status)
    throw error
  }
  delete patch.isFixture

  const referenceError = await validateBookStudioReferences(orgId, patch)
  if (referenceError) return referenceError

  if (body.deleted === true) patch.deleted = true

  await docRef.update({
    ...patch,
    ...bookStudioPatchDeletes(resource, body, () => FieldValue.delete()),
    updatedBy: uid,
    updatedByType: 'user',
    updatedAt: FieldValue.serverTimestamp(),
  })
  return apiSuccess({ id, resource, updated: true })
})
