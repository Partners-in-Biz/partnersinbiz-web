// app/api/v1/properties/route.ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import { generateIngestKey } from '@/lib/properties/ingest-key'
import { VALID_PROPERTY_TYPES, VALID_PROPERTY_STATUSES } from '@/lib/properties/types'
import type { CreatePropertyInput, PropertyStatus, PropertyType } from '@/lib/properties/types'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { canAccessOrg } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 50

export const GET = withAuth('admin', async (req: NextRequest) => {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('orgId')
  if (!orgId) return apiError('orgId is required', 400)

  const status = searchParams.get('status')
  const type = searchParams.get('type')
  const rawLimit = parseInt(searchParams.get('limit') ?? `${DEFAULT_LIMIT}`, 10)
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIMIT, 1), 200)
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10), 0)

  let query: FirebaseFirestore.Query = adminDb.collection('properties')
    .where('orgId', '==', orgId)
    .where('deleted', '==', false)
    .orderBy('createdAt', 'desc')

  if (status && VALID_PROPERTY_STATUSES.includes(status as PropertyStatus)) {
    query = query.where('status', '==', status)
  }
  if (type && VALID_PROPERTY_TYPES.includes(type as PropertyType)) {
    query = query.where('type', '==', type)
  }

  const snap = await query.limit(limit).offset(offset).get().catch((err) => {
    console.error('[properties-list-error]', err)
    return null
  })
  if (!snap) return apiError('Failed to list properties', 500)
  const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }))

  return apiSuccess(data)
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await req.json() as CreatePropertyInput

  if (!body.orgId?.trim()) return apiError('orgId is required', 400)
  if (!canAccessOrg(user, body.orgId.trim())) return apiError('Forbidden', 403)
  if (!body.name?.trim()) return apiError('name is required', 400)
  if (!body.domain?.trim()) return apiError('domain is required', 400)
  if (!body.type || !VALID_PROPERTY_TYPES.includes(body.type)) {
    return apiError(`type must be one of: ${VALID_PROPERTY_TYPES.join(', ')}`, 400)
  }

  const ingestKey = generateIngestKey()

  const doc = {
    orgId: body.orgId.trim(),
    name: body.name.trim(),
    domain: body.domain.trim().toLowerCase(),
    type: body.type,
    status: (body.status && VALID_PROPERTY_STATUSES.includes(body.status)) ? body.status : 'draft',
    config: body.config ?? {},
    conversionSequenceId: body.conversionSequenceId ?? null,
    emailSenderDomain: body.emailSenderDomain ?? null,
    creatorLinkPrefix: body.creatorLinkPrefix ?? null,
    ingestKey,
    ingestKeyRotatedAt: FieldValue.serverTimestamp(),
    deleted: false,
    ...actorFrom(user),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  try {
    const ref = await adminDb.collection('properties').add(doc)
    try {
      await dispatchWebhook(body.orgId, 'property.created', { id: ref.id, name: doc.name, domain: doc.domain, type: doc.type })
    } catch (err) {
      console.error('[webhook-dispatch-error] property.created', err)
    }
    return apiSuccess({ id: ref.id, ...doc, ingestKey }, 201)
  } catch (err) {
    console.error('[properties-create-error]', err)
    return apiError('Failed to create property', 500)
  }
})
