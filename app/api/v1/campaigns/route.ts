/**
 * GET  /api/v1/campaigns?orgId=...&status=...&limit=...   — list campaigns for an org
 * POST /api/v1/campaigns                                  — create a draft campaign
 *
 * This collection is shared by two campaign shapes:
 *   1. Email program campaigns (lib/campaigns/types.ts) — original flow
 *   2. Content-engine campaigns (lib/types/campaign.ts) — adds research,
 *      brandIdentity, pillars, calendar, shareToken
 *
 * POST branches on `body.clientType`. If present, we create a content-engine
 * campaign. Otherwise the legacy email-campaign create runs. Both produce a
 * `draft` doc soft-deletable via `deleted`.
 *
 * Auth: admin/client (clients are scoped to their own orgId).
 */
import { NextRequest } from 'next/server'
import { randomBytes } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withIdempotency } from '@/lib/api/idempotency'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import { EMPTY_STATS, type Campaign as EmailCampaign, type CampaignStatus as EmailCampaignStatus } from '@/lib/campaigns/types'
import type { CampaignClientType } from '@/lib/types/campaign'
import type { ApiUser } from '@/lib/api/types'
import { logActivity } from '@/lib/activity/log'
import {
  normalizeResourceRelationshipLinks,
} from '@/lib/client-documents/linkedValidation'

export const dynamic = 'force-dynamic'

const VALID_EMAIL_STATUSES: EmailCampaignStatus[] = ['draft', 'scheduled', 'active', 'paused', 'completed']
const VALID_CONTENT_STATUSES = ['draft', 'in_review', 'approved', 'shipping', 'archived'] as const
const VALID_CLIENT_TYPES: CampaignClientType[] = ['service-business', 'consumer-app', 'b2b-saas']

function relationshipInputFrom(body: Record<string, unknown>) {
  const value: Record<string, unknown> = {}
  const safeStringFields = ['companyId', 'clientOrgId', 'projectId', 'dealId']
  const safeArrayFields = [
    'companyIds',
    'clientOrgIds',
    'projectIds',
    'dealIds',
    'researchItemIds',
    'socialPostIds',
    'emailThreadIds',
    'supportTicketIds',
  ]
  for (const key of safeStringFields) {
    if (key in body) value[key] = body[key]
  }
  for (const key of safeArrayFields) {
    if (key in body) value[key] = body[key]
  }
  if ('contextRefs' in body) value.contextRefs = body.contextRefs
  return Object.keys(value).length > 0 ? value : undefined
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId
  const status = searchParams.get('status')
  const limitParam = searchParams.get('limit')
  const limit = limitParam ? Math.max(1, Math.min(500, parseInt(limitParam, 10) || 100)) : 500

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = adminDb.collection('campaigns')
    .where('orgId', '==', orgId)
  // The collection holds two shapes — only the email-campaign shape has the
  // legacy email statuses. Filter loosely; we accept either status family.
  if (status && (VALID_EMAIL_STATUSES.includes(status as EmailCampaignStatus) ||
      (VALID_CONTENT_STATUSES as readonly string[]).includes(status))) {
    query = query.where('status', '==', status)
  }

  const snap = await query.get()
  const campaigns = snap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any) => ({ id: d.id, ...d.data() }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((c: any) => c.deleted !== true)
    .slice(0, limit)

  return apiSuccess(campaigns)
})

export const POST = withAuth(
  'client',
  withIdempotency(async (req: NextRequest, user: ApiUser) => {
    const body = await req.json().catch(() => null)
    if (!body) return apiError('Invalid JSON', 400)

    // Branch: content-engine campaign requested via clientType
    if (body.clientType !== undefined) {
      return createContentEngineCampaign(body, user)
    }

    return createEmailCampaign(body, user)
  }),
)

async function createContentEngineCampaign(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
  user: ApiUser,
) {
  const requestedOrgId = typeof body.orgId === 'string' ? body.orgId.trim() : null
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId

  if (!body.name || typeof body.name !== 'string') return apiError('name is required', 400)
  if (!VALID_CLIENT_TYPES.includes(body.clientType)) {
    return apiError(`clientType must be one of: ${VALID_CLIENT_TYPES.join(', ')}`, 400)
  }

  const relationshipInput = relationshipInputFrom(body as Record<string, unknown>)
  const relationships = relationshipInput
    ? normalizeResourceRelationshipLinks(relationshipInput)
    : { ok: true as const, value: {} }
  if (!relationships.ok) return apiError(relationships.error, 400)

  const shareToken = randomBytes(12).toString('hex') // 24 hex chars

  const ref = await adminDb.collection('campaigns').add({
    orgId,
    clientId: typeof body.clientId === 'string' ? body.clientId : orgId,
    name: body.name.trim(),
    clientType: body.clientType,
    status: 'draft',
    shareToken,
    shareEnabled: true,
    research: body.research ?? null,
    brandIdentity: body.brandIdentity ?? null,
    pillars: Array.isArray(body.pillars) ? body.pillars : [],
    calendar: Array.isArray(body.calendar) ? body.calendar : [],
    ...relationships.value,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
    ...actorFrom(user),
    updatedBy: user.uid,
    updatedByType: user.role === 'ai' ? 'agent' : 'user',
  })

  logActivity({
    orgId,
    type: 'campaign_created',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: `Created campaign: "${body.name.trim()}"`,
    entityId: ref.id,
    entityType: 'campaign',
    entityTitle: body.name.trim(),
  }).catch(() => {})

  return apiSuccess({ id: ref.id, shareToken, status: 'draft', orgId }, 201)
}

async function createEmailCampaign(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
  user: ApiUser,
) {
  const requestedOrgId = typeof body.orgId === 'string' ? body.orgId.trim() : null
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return apiError('name is required', 400)

  const relationshipInput = relationshipInputFrom(body as Record<string, unknown>)
  const relationships = relationshipInput
    ? normalizeResourceRelationshipLinks(relationshipInput)
    : { ok: true as const, value: {} }
  if (!relationships.ok) return apiError(relationships.error, 400)

  const sequenceId = typeof body.sequenceId === 'string' ? body.sequenceId.trim() : ''
  if (sequenceId) {
    const seqSnap = await adminDb.collection('sequences').doc(sequenceId).get()
    if (!seqSnap.exists) return apiError('sequenceId not found', 400)
    if (seqSnap.data()?.orgId && seqSnap.data()?.orgId !== orgId) {
      return apiError('sequenceId belongs to a different organisation', 403)
    }
  }

  const docRef = await adminDb.collection('campaigns').add({
    orgId,
    name,
    description: body.description ?? '',
    status: 'draft',
    fromDomainId: body.fromDomainId ?? '',
    fromName: body.fromName ?? '',
    fromLocal: body.fromLocal ?? 'campaigns',
    replyTo: body.replyTo ?? '',
    segmentId: body.segmentId ?? '',
    contactIds: Array.isArray(body.contactIds) ? body.contactIds : [],
    ...relationships.value,
    sequenceId,
    triggers: {
      captureSourceIds: Array.isArray(body.triggers?.captureSourceIds) ? body.triggers.captureSourceIds : [],
      tags: Array.isArray(body.triggers?.tags) ? body.triggers.tags : [],
    },
    startAt: null,
    endAt: null,
    stats: EMPTY_STATS,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: user.uid,
    deleted: false,
  })

  // Suppress unused-import warning when the typed value is consumed only at runtime.
  void ({} as Partial<EmailCampaign>)

  logActivity({
    orgId,
    type: 'campaign_created',
    actorId: user.uid,
    actorName: user.uid,
    actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    description: `Created campaign: "${name}"`,
    entityId: docRef.id,
    entityType: 'campaign',
    entityTitle: name,
  }).catch(() => {})

  return apiSuccess({ id: docRef.id }, 201)
}
