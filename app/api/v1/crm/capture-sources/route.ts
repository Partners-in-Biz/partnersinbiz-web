/**
 * GET  /api/v1/crm/capture-sources   — list sources for the authenticated org
 * POST /api/v1/crm/capture-sources   — create a new capture source
 *
 * Body (POST): { name, type, autoTags?, autoCampaignIds?, autoSequenceIds?, redirectUrl?, consentRequired? }
 * Auth: GET → viewer+, POST → admin+
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  generatePublicKey,
  type CaptureSource,
  type CaptureSourceType,
} from '@/lib/crm/captureSources'
import { touchPortalDashboardSummary } from '@/lib/portal/dashboard-summary'

const VALID_TYPES: CaptureSourceType[] = ['form', 'api', 'csv', 'integration', 'manual']

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

export const GET = withCrmAuth('viewer', async (req: NextRequest, ctx) => {
  const orgId = ctx.orgId
  const { searchParams } = new URL(req.url)
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '100', 10) || 100))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = (adminDb.collection('capture_sources') as any)
    .where('orgId', '==', orgId)
    .where('deleted', '==', false)
    .orderBy('createdAt', 'desc')
  const totalPromise = typeof query.count === 'function'
    ? query.count().get().then((aggregate: { data: () => { count?: number } }) => aggregate.data().count ?? 0)
    : Promise.resolve(null)
  const limitedQuery = typeof query.limit === 'function' ? query.limit(limit) : query
  const snap = await limitedQuery.get()
  const total = await totalPromise

  const sources: CaptureSource[] = snap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any) => ({ id: d.id, ...d.data() }) as CaptureSource)

  return apiSuccess(sources, 200, { total: total ?? sources.length, page: 1, limit, orgId })
})

export const POST = withCrmAuth('admin', async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null)
  if (!body) return apiError('Invalid JSON', 400)

  const orgId = ctx.orgId
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const type = body.type as CaptureSourceType | undefined
  if (!name) return apiError('name is required', 400)
  if (!type || !VALID_TYPES.includes(type)) return apiError('Invalid or missing type', 400)

  // PR 3 pattern 1: use ctx.actor directly (no snapshotForWrite)
  const actorRef = ctx.actor

  // Sanitize: strip undefined values so Firestore doesn't reject
  const doc: Record<string, unknown> = {
    orgId,
    name,
    type,
    publicKey: generatePublicKey(),
    enabled: true,
    autoTags: stringList(body.autoTags),
    autoCampaignIds: stringList(body.autoCampaignIds),
    autoSequenceIds: stringList(body.autoSequenceIds),
    redirectUrl: typeof body.redirectUrl === 'string' ? body.redirectUrl : '',
    consentRequired: body.consentRequired === true,
    capturedCount: 0,
    lastCapturedAt: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
    createdByRef: actorRef,
    updatedByRef: actorRef,
  }

  // Omit createdBy / updatedBy uid for agent calls
  if (!ctx.isAgent) {
    doc.createdBy = ctx.actor.uid
    doc.updatedBy = ctx.actor.uid
  }

  const docRef = await adminDb.collection('capture_sources').add(doc)
  await touchPortalDashboardSummary({
    orgId,
    increments: {
      'counts.captureSources': 1,
    },
    staleReason: 'capture_source.created',
  })
  const created = await docRef.get()
  return apiSuccess({ id: docRef.id, ...created.data() }, 201)
})
