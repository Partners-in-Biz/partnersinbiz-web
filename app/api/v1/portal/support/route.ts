import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  createSupportTicket,
  listPortalSupportTickets,
  validateSupportInput,
} from '@/lib/support/store'
import { resolveContextReferences } from '@/lib/context-references/registry'
import { sanitizeContextReferenceSeeds } from '@/lib/context-references/types'
import {
  RESOURCE_RELATIONSHIP_ARRAY_FIELDS,
  RESOURCE_RELATIONSHIP_STRING_FIELDS,
  normalizeResourceRelationshipLinks,
} from '@/lib/client-documents/linkedValidation'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

function relationshipInputFrom(body: Record<string, unknown>) {
  const value: Record<string, unknown> = {}
  for (const key of RESOURCE_RELATIONSHIP_STRING_FIELDS) {
    if (key in body) value[key] = body[key]
  }
  for (const key of RESOURCE_RELATIONSHIP_ARRAY_FIELDS) {
    if (key in body) value[key] = body[key]
  }
  return Object.keys(value).length > 0 ? value : undefined
}

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, uid: string, orgId: string) => {
  const tickets = await listPortalSupportTickets(orgId, uid)
  return apiSuccess(tickets)
})

export const POST = withPortalAuthAndRole('viewer', async (req: NextRequest, uid: string, orgId: string) => {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid JSON', 400)

  const parsed = validateSupportInput(body as Record<string, unknown>)
  if (!parsed.ok) return apiError(parsed.error, 400)

  const userDoc = await adminDb.collection('users').doc(uid).get()
  const user = userDoc.data() ?? {}
  const requesterName =
    typeof user.name === 'string' && user.name.trim()
      ? user.name.trim()
      : typeof user.displayName === 'string' && user.displayName.trim()
        ? user.displayName.trim()
        : 'Client'
  const requesterEmail = typeof user.email === 'string' ? user.email.trim() : ''
  const apiUser: ApiUser = {
    uid,
    role: 'client',
    orgId,
    orgIds: [orgId],
    authKind: 'session',
  }
  const contextRefs = await resolveContextReferences(
    sanitizeContextReferenceSeeds((body as Record<string, unknown>).contextRefs),
    apiUser,
    orgId,
  )
  const relationshipInput = relationshipInputFrom(body as Record<string, unknown>)
  const relationships = relationshipInput
    ? normalizeResourceRelationshipLinks(relationshipInput)
    : { ok: true as const, value: {} }
  if (!relationships.ok) return apiError(relationships.error, 400)

  const id = await createSupportTicket({
    orgId,
    uid,
    requesterName,
    requesterEmail,
    contextRefs,
    relationshipLinks: relationships.value,
    ...parsed.value,
  })

  return apiSuccess({ id }, 201)
})
