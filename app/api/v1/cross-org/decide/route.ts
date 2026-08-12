import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { createCrossOrgPolicyService } from '@/lib/cross-org/policy-service'
import type { PartnerResourceType } from '@/lib/cross-org/types'
import type { SharedBusinessCapability } from '@/lib/business-relationships/types'
import { MARKETING_COLLABORATION_CONTRACTS } from '@/lib/cross-org/marketing-collaboration'

export const dynamic = 'force-dynamic'

const RESOURCE_TYPES: readonly string[] = [
  'project',
  'document',
  'invoice',
  'quote',
  'conversation',
  'deal',
  'campaign',
  'social_post',
  'email',
  'seo',
  'ads',
  'analytics',
  'support',
  'service',
  'research',
  'property',
  'custom',
]

const CAPABILITIES: readonly string[] = [
  'crm',
  'projects',
  'documents',
  'orders',
  'shipments',
  'inventory',
  'invoices',
  'analytics',
  'support',
  'services',
]

const MARKETING_RESOURCE_TYPES = new Set(Object.values(MARKETING_COLLABORATION_CONTRACTS).map((contract) => contract.resourceType))
const ADAPTER_ONLY_RESOURCE_TYPES = new Set(['research', 'property'])

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
}

/**
 * POST /api/v1/cross-org/decide
 *
 * Tenant-safe audit decision API. Evaluates ONE cross-org access decision for
 * the authenticated caller's active org (actor org/user come from the auth
 * context — never from the request body) and returns:
 *
 *   { allowed, reason, reasonCode, chain, projection, partnerLinkId,
 *     scopeAgreementId, resourceGrantId, auditEventId }
 *
 * The caller may only ask about resources they are party to through a live
 * canonical Partner Link; every denial carries a stable reason code and the
 * full decision chain. When recordDecision !== false an append-only
 * access.decided audit event is emitted (actor org, ids, reason only — never
 * foreign resource payloads).
 */
export const POST = withCrmAuth('member', async (req: NextRequest, ctx: CrmAuthContext) => {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>

    const resourceType = cleanString(body.resourceType)
    const resourceId = cleanString(body.resourceId)
    const action = cleanString(body.action)
    const partnerLinkId = cleanString(body.partnerLinkId) || undefined
    const requiredCapability = cleanString(body.requiredCapability) || undefined
    const field = cleanString(body.field) || undefined
    const item = cleanString(body.item) || undefined
    const actorRole = cleanString(body.actorRole) || undefined
    const actorTeamIds = cleanStringArray(body.actorTeamIds)
    const recordDecision = body.recordDecision !== false

    if (!resourceType) return apiError('resourceType is required', 400)
    if (!RESOURCE_TYPES.includes(resourceType)) return apiError('resourceType must be a known cross-org resource type', 400)
    if (MARKETING_RESOURCE_TYPES.has(resourceType as PartnerResourceType)) {
      return apiError('Marketing and analytics collaboration decisions must use /api/v1/cross-org/marketing/decide.', 403)
    }
    if (ADAPTER_ONLY_RESOURCE_TYPES.has(resourceType)) {
      return apiError('Research and property collaboration decisions require an adapter-backed route.', 403)
    }
    if (!resourceId) return apiError('resourceId is required', 400)
    if (!action) return apiError('action is required', 400)
    if (requiredCapability && !CAPABILITIES.includes(requiredCapability)) {
      return apiError('requiredCapability must be a known shared business capability', 400)
    }
    if (partnerLinkId && !partnerLinkId.startsWith('link-')) {
      return apiError('partnerLinkId must reference a canonical partner link', 400)
    }

    const service = createCrossOrgPolicyService()
    const result = await service.decide({
      actor: {
        userId: ctx.actor.uid,
        orgId: ctx.orgId,
        platformAdmin: false,
      },
      actorRef: ctx.actor,
      resourceType: resourceType as PartnerResourceType,
      resourceId,
      action,
      field,
      item,
      partnerLinkId,
      requiredCapability: requiredCapability as SharedBusinessCapability | undefined,
      actorRole,
      actorTeamIds,
      recordDecision,
    })

    return apiSuccess(result)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
