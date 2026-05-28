import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { assertClientDocumentDataAccess, getAccessibleClientDocument } from '@/lib/client-documents/access'
import { validateClientDocumentLinks } from '@/lib/client-documents/linkedValidation'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import type { ClientDocument, DocumentAssumption } from '@/lib/client-documents/types'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const PATCH_FIELDS = new Set(['title', 'linked', 'assumptions', 'shareEnabled'])
const ASSUMPTION_FIELDS = new Set([
  'id',
  'text',
  'severity',
  'status',
  'blockId',
  'createdBy',
  'createdAt',
  'resolvedBy',
  'resolvedAt',
])
const ASSUMPTION_SEVERITIES = new Set(['info', 'needs_review', 'blocks_publish'])
const ASSUMPTION_STATUSES = new Set(['open', 'resolved'])

function actorType(user: ApiUser) {
  return user.role === 'ai' ? 'agent' : 'user'
}

function validateAssumptions(
  value: unknown,
): { ok: true; value: DocumentAssumption[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'assumptions must be an array' }

  for (const [index, assumption] of value.entries()) {
    if (!assumption || typeof assumption !== 'object' || Array.isArray(assumption)) {
      return { ok: false, error: `assumptions[${index}] must be an object` }
    }

    const row = assumption as Record<string, unknown>
    const unknownFields = Object.keys(row).filter((field) => !ASSUMPTION_FIELDS.has(field))
    if (unknownFields.length > 0) {
      return { ok: false, error: `assumptions[${index}] contains unsupported field(s): ${unknownFields.join(', ')}` }
    }

    for (const field of ['id', 'text', 'createdBy']) {
      if (typeof row[field] !== 'string') {
        return { ok: false, error: `assumptions[${index}].${field} must be a string` }
      }
    }

    if (typeof row.severity !== 'string' || !ASSUMPTION_SEVERITIES.has(row.severity)) {
      return { ok: false, error: `assumptions[${index}].severity must be one of: info, needs_review, blocks_publish` }
    }

    if (typeof row.status !== 'string' || !ASSUMPTION_STATUSES.has(row.status)) {
      return { ok: false, error: `assumptions[${index}].status must be one of: open, resolved` }
    }

    for (const field of ['blockId', 'resolvedBy', 'createdAt', 'resolvedAt']) {
      if (field in row && row[field] !== undefined && typeof row[field] !== 'string') {
        return { ok: false, error: `assumptions[${index}].${field} must be a string` }
      }
    }
  }

  return { ok: true, value: value as DocumentAssumption[] }
}

export const GET = withAuth('client', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user)
  if (!access.ok) return access.response

  return apiSuccess(access.document)
})

export const PATCH = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)

  const invalidFields = Object.keys(body).filter((field) => !PATCH_FIELDS.has(field))
  if (invalidFields.length > 0) {
    return apiError(`Unsupported field(s): ${invalidFields.join(', ')}`, 400)
  }

  const update: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: user.uid,
    updatedByType: actorType(user),
  }

  if ('title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return apiError('title cannot be empty', 400)
    update.title = title
  }

  if ('linked' in body) {
    const linked = validateClientDocumentLinks(body.linked)
    if (!linked.ok) return apiError(linked.error, 400)
    update.linked = linked.value
  }

  if ('assumptions' in body) {
    const assumptions = validateAssumptions(body.assumptions)
    if (!assumptions.ok) return apiError(assumptions.error, 400)
    update.assumptions = assumptions.value
  }

  if ('shareEnabled' in body) {
    if (typeof body.shareEnabled !== 'boolean') return apiError('shareEnabled must be a boolean', 400)
    update.shareEnabled = body.shareEnabled
  }

  const documentRef = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id)
  const result = await adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(documentRef)
    if (!snap.exists || snap.data()?.deleted === true) {
      return { ok: false as const, response: apiError('Document not found', 404) }
    }

    const access = assertClientDocumentDataAccess(snap.data() as Partial<ClientDocument>, user)
    if (!access.ok) return access

    transaction.update(documentRef, update)
    return { ok: true as const }
  })

  if (!result.ok) return result.response

  return apiSuccess({ id, updated: Object.keys(update) })
})

export const DELETE = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const documentRef = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(id)

  const result = await adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(documentRef)
    if (!snap.exists || snap.data()?.deleted === true) {
      return { ok: false as const, response: apiError('Document not found', 404) }
    }

    const access = assertClientDocumentDataAccess(snap.data() as Partial<ClientDocument>, user)
    if (!access.ok) return access

    transaction.update(documentRef, {
      status: 'archived',
      deleted: true,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: user.uid,
      updatedByType: actorType(user),
    })

    return { ok: true as const }
  })

  if (!result.ok) return result.response

  return apiSuccess({ id, status: 'archived' })
})
