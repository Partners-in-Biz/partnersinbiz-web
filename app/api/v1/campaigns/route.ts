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
import { touchPortalDashboardSummary } from '@/lib/portal/dashboard-summary'
import { sanitizeAudienceDefinition } from '@/lib/email-marketing/audience-snapshot'
import {
  filterOwnedRowsForActor,
  memberSeesAllModuleRecords,
} from '@/lib/orgMembers/record-scope'
import { campaignVisibleForScope, PERSONAL_SCOPE, ownerFieldsForWrite, resolveMarketingOwnerFromSearchParams, resolveMarketingOwnerFromValues } from '@/lib/social/account-scope'
import { clientVisibilityFieldsForWrite } from '@/lib/work-scope'

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
  const personalScope = searchParams.get('scope') === PERSONAL_SCOPE
  const owner = resolveMarketingOwnerFromSearchParams(searchParams, user.uid)
  const status = searchParams.get('status')
  const limitParam = searchParams.get('limit')
  const limit = limitParam ? Math.max(1, Math.min(500, parseInt(limitParam, 10) || 100)) : 500

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = adminDb.collection('campaigns')
    .where('orgId', '==', orgId)
    .where('deleted', '==', false)
  // The collection holds two shapes — only the email-campaign shape has the
  // legacy email statuses. Filter loosely; we accept either status family.
  if (status && (VALID_EMAIL_STATUSES.includes(status as EmailCampaignStatus) ||
      (VALID_CONTENT_STATUSES as readonly string[]).includes(status))) {
    query = query.where('status', '==', status)
  }

  const snap = await query.limit(limit).get()
  const campaigns = snap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any) => ({ id: d.id, ...d.data() }))

  // Members with an owned_or_linked marketing scope see only campaigns they
  // own / are shared / linked to their CRM book; admins, agents and 'all'
  // members pass through unchanged. The aggregate count would leak rows a
  // scoped member cannot see, so scoped members get the filtered length.
  const seesAllMarketing = await memberSeesAllModuleRecords(user, orgId, 'marketing')
  const visibleCampaigns = (seesAllMarketing
    ? campaigns
    : await filterOwnedRowsForActor(user, orgId, 'marketing', campaigns)
  ).filter((campaign: { accountScope?: unknown; ownerUid?: unknown; companyId?: unknown; marketingOwner?: unknown }) =>
    campaignVisibleForScope(campaign, { personal: personalScope, uid: user.uid, companyId: owner.companyId }),
  )
  const total = visibleCampaigns.length

  return apiSuccess(visibleCampaigns, 200, { total, page: 1, limit, orgId })
})

export const POST = withAuth(
  'client',
  withIdempotency(async (req: NextRequest, user: ApiUser) => {
    const body = await req.json().catch(() => null)
    if (!body) return apiError('Invalid JSON', 400)
    const url = new URL(req.url)
    const personalScope = url.searchParams.get('scope') === PERSONAL_SCOPE
      || body.accountScope === PERSONAL_SCOPE
      || body.scope === PERSONAL_SCOPE
    const owner = resolveMarketingOwnerFromValues({
      personal: personalScope,
      scope: url.searchParams.get('scope'),
      companyId: url.searchParams.get('companyId'),
      sourceCompanyId: url.searchParams.get('sourceCompanyId') || body.sourceCompanyId,
      uid: user.uid,
    })

    // Branch: content-engine campaign requested via clientType
    if (body.clientType !== undefined) {
      return createContentEngineCampaign(body, user, owner)
    }

    if (personalScope) {
      return apiError('Personal campaigns are content campaigns only. Email programmes stay in the organisation workspace.', 400)
    }

    return createEmailCampaign(body, user, owner)
  }),
)

async function createContentEngineCampaign(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
  user: ApiUser,
  owner: ReturnType<typeof resolveMarketingOwnerFromValues>,
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
    ...ownerFieldsForWrite(owner),
    ...clientVisibilityFieldsForWrite(body.clientVisibility),
    ...relationships.value,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
    ...actorFrom(user),
    updatedBy: user.uid,
    updatedByType: user.role === 'ai' ? 'agent' : 'user',
  })
  await touchPortalDashboardSummary({
    orgId,
    staleReason: 'campaign.created',
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

  const handoff = await import('@/lib/messages/openContextHandoff')
    .then((mod) => mod.handoffOpenContextFromCreate({
      orgId,
      body: body as Record<string, unknown>,
      kind: 'campaign',
      id: ref.id,
      label: body.name.trim(),
      summary: 'status: draft | content-engine campaign',
    }))
    .catch(() => null)

  return apiSuccess({
    id: ref.id,
    shareToken,
    status: 'draft',
    orgId,
    ...(handoff ? {
      contextRef: handoff.contextRef,
      uiActions: handoff.uiActions,
      messagesAttach: handoff.messagesAttach,
    } : {}),
  }, 201)
}

async function createEmailCampaign(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
  user: ApiUser,
  owner: ReturnType<typeof resolveMarketingOwnerFromValues>,
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

  let audienceDefinition = null
  if (body.audienceDefinition != null) {
    try {
      audienceDefinition = sanitizeAudienceDefinition(body.audienceDefinition)
    } catch (error) {
      return apiError(error instanceof Error ? error.message : 'Invalid audience definition', 400)
    }
  }

  const docRef = await adminDb.collection('campaigns').add({
    orgId,
    name,
    description: body.description ?? '',
    // Email-builder fields stored on the campaign doc (not yet in the strict
    // Campaign type — see lib/campaigns/types.ts).
    subject: typeof body.subject === 'string' ? body.subject : '',
    previewText: typeof body.previewText === 'string' ? body.previewText : '',
    emailDocument: body.emailDocument && typeof body.emailDocument === 'object' ? body.emailDocument : null,
    exclusionContactIds: Array.isArray(body.exclusionContactIds)
      ? body.exclusionContactIds.filter((v: unknown) => typeof v === 'string')
      : [],
    tagId: typeof body.tagId === 'string' ? body.tagId : '',
    status: 'draft',
    senderPolicyId: typeof body.senderPolicyId === 'string' ? body.senderPolicyId.trim() : '',
    replyPolicyId: typeof body.replyPolicyId === 'string' ? body.replyPolicyId.trim() : '',
    fromDomainId: body.fromDomainId ?? '',
    fromName: body.fromName ?? '',
    fromLocal: body.fromLocal ?? 'campaigns',
    replyTo: body.replyTo ?? '',
    segmentId: body.segmentId ?? '',
    contactIds: Array.isArray(body.contactIds) ? body.contactIds : [],
    audienceDefinition,
    ...ownerFieldsForWrite(owner),
    ...clientVisibilityFieldsForWrite(body.clientVisibility),
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
    createdByType: user.role === 'ai' ? 'agent' : 'user',
    approvalState: {
      status: user.role === 'ai' ? 'pending' : 'not_required',
      approvedBy: null,
      approvedAt: null,
    },
    deleted: false,
  })
  await touchPortalDashboardSummary({
    orgId,
    staleReason: 'campaign.created',
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

  const handoff = await import('@/lib/messages/openContextHandoff')
    .then((mod) => mod.handoffOpenContextFromCreate({
      orgId,
      body: body as Record<string, unknown>,
      kind: 'campaign',
      id: docRef.id,
      label: name,
      summary: 'status: draft | email campaign',
    }))
    .catch(() => null)

  return apiSuccess({
    id: docRef.id,
    ...(handoff ? {
      contextRef: handoff.contextRef,
      uiActions: handoff.uiActions,
      messagesAttach: handoff.messagesAttach,
    } : {}),
  }, 201)
}
