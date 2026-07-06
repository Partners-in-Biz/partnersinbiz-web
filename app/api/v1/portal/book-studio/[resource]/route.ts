import { NextRequest } from 'next/server'
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
import {
  BookStudioValidationError,
  sanitizeBookStudioRecordInput,
  serializeBookStudioRecord,
} from '@/lib/book-studio/sanitize'
import { portalBookStudioGuard, portalActorFields } from '@/lib/book-studio/portal'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ resource: string }> }

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, _uid: string, orgId: string, role, context: Ctx) => {
  const { resource } = await context.params
  if (!isBookStudioResourceKey(resource)) return apiError('Unknown Book Studio resource', 404)
  const requiredAction = portalActionForRequest('GET', resource, {})
  if (!requiredAction) return apiError('Unknown Book Studio resource', 404)

  const guard = await portalBookStudioGuard(orgId)
  if (guard.error) return guard.error
  const caps = resolveBookStudioCapabilities(guard.settings, role, false)
  if (!caps[requiredAction]) return apiError('Your role does not have access to this Book Studio action', 403)

  const snap = await adminDb.collection(collectionFor(resource)).where('orgId', '==', orgId).get()
  const records = snap.docs
    .map((doc) => serializeBookStudioRecord(doc.id, doc.data()))
    .filter((record) => record.deleted !== true && record.isFixture !== true)
  return apiSuccess({ resource, records, capabilities: caps, orgId })
})

export const POST = withPortalAuthAndRole('viewer', async (req: NextRequest, uid: string, orgId: string, role, context: Ctx) => {
  const { resource } = await context.params
  if (!isBookStudioResourceKey(resource)) return apiError('Unknown Book Studio resource', 404)

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return apiError('Malformed JSON body', 400)
  }

  const requiredAction = portalActionForRequest('POST', resource, body)
  if (!requiredAction) return apiError('Unknown Book Studio resource', 404)

  const guard = await portalBookStudioGuard(orgId)
  if (guard.error) return guard.error
  const caps = resolveBookStudioCapabilities(guard.settings, role, false)
  if (!caps[requiredAction]) return apiError('Your role does not have access to this Book Studio action', 403)

  const dispatchFields = findBookStudioRuntimeDispatchFields(body)
  if (dispatchFields.length) return apiError('Book Studio Hermes runtime dispatch is not enabled in V1', 403)

  let data
  try {
    // orgId comes from the portal session, never the body.
    data = sanitizeBookStudioRecordInput(resource, { ...body, orgId }, orgId)
  } catch (error) {
    if (error instanceof BookStudioValidationError) return apiError(error.message, error.status)
    throw error
  }
  // Portal callers can never mark fixtures.
  delete (data as Record<string, unknown>).isFixture

  const referenceError = await validateBookStudioReferences(orgId, data)
  if (referenceError) return referenceError

  const ref = await adminDb.collection(collectionFor(resource)).add({
    ...data,
    ...portalActorFields(uid),
  })
  return apiSuccess({ id: ref.id, resource }, 201)
})
