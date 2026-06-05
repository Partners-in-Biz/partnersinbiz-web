import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { isMailboxFolder, serializeMessage, splitEmails } from '@/lib/mailbox/serializers'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import {
  RESOURCE_RELATIONSHIP_ARRAY_FIELDS,
  RESOURCE_RELATIONSHIP_STRING_FIELDS,
  normalizeResourceRelationshipLinks,
} from '@/lib/client-documents/linkedValidation'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

function relationshipInputFrom(body: Record<string, unknown>) {
  const value: Record<string, unknown> = {}
  for (const key of RESOURCE_RELATIONSHIP_STRING_FIELDS) {
    if (key in body) value[key] = body[key]
  }
  for (const key of RESOURCE_RELATIONSHIP_ARRAY_FIELDS) {
    if (key in body) value[key] = body[key]
  }
  if ('contextRefs' in body) value.contextRefs = body.contextRefs
  return Object.keys(value).length > 0 ? value : undefined
}

async function loadOwnedMessage(id: string, orgId: string, uid: string) {
  const ref = adminDb.collection('mailbox_messages').doc(id)
  const doc = await ref.get()
  if (!doc.exists) return null
  const data = doc.data() ?? {}
  if (data.orgId !== orgId || data.uid !== uid) return null
  return { ref, data }
}

export const PATCH = withAuth('admin', async (req: NextRequest, user, ctx: Ctx) => {
  try {
    const orgId = PIB_PLATFORM_ORG_ID
    const uid = user.uid
    const { id } = await ctx.params
    const owned = await loadOwnedMessage(id, orgId, uid)
    if (!owned) return apiError('Email message not found', 404)
    const body = await req.json().catch(() => ({}))
    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }

    if (typeof body.read === 'boolean') patch.read = body.read
    if (typeof body.starred === 'boolean') patch.starred = body.starred
    if (isMailboxFolder(body.folder)) patch.folder = body.folder

    if (owned.data.status === 'draft') {
      if (typeof body.subject === 'string') patch.subject = body.subject.trim()
      if (typeof body.bodyText === 'string') {
        patch.bodyText = body.bodyText
        patch.snippet = body.bodyText.replace(/\s+/g, ' ').slice(0, 180)
      }
      if (typeof body.bodyHtml === 'string') patch.bodyHtml = body.bodyHtml
      if ('to' in body) patch.to = splitEmails(body.to)
      if ('cc' in body) patch.cc = splitEmails(body.cc)
      if ('bcc' in body) patch.bcc = splitEmails(body.bcc)

      const relationshipInput = relationshipInputFrom(body as Record<string, unknown>)
      if (relationshipInput) {
        const relationships = normalizeResourceRelationshipLinks(relationshipInput)
        if (!relationships.ok) return apiError(relationships.error, 400)
        Object.assign(patch, relationships.value)
      }
    }

    await owned.ref.set(patch, { merge: true })
    const fresh = await owned.ref.get()
    return apiSuccess({ message: serializeMessage(id, fresh.data() ?? {}) })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const DELETE = withAuth('admin', async (_req: NextRequest, user, ctx: Ctx) => {
  try {
    const orgId = PIB_PLATFORM_ORG_ID
    const uid = user.uid
    const { id } = await ctx.params
    const owned = await loadOwnedMessage(id, orgId, uid)
    if (!owned) return apiError('Email message not found', 404)
    if (owned.data.folder === 'trash') {
      await owned.ref.delete()
    } else {
      await owned.ref.set({ folder: 'trash', updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    }
    return apiSuccess({ id })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
