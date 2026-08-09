import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { createCrossOrgPolicyService } from '@/lib/cross-org/policy-service'
import {
  MARKETING_COLLABORATION_CONTRACTS,
  MarketingCollaborationPolicyError,
  resolveMarketingCollaborationAction,
  type MarketingCollaborationMode,
  type MarketingCollaborationModule,
} from '@/lib/cross-org/marketing-collaboration'
import { loadMarketingResourceOwner } from '@/lib/cross-org/marketing-resource-owner'

export const dynamic = 'force-dynamic'

const MODES: readonly MarketingCollaborationMode[] = [
  'request_brief', 'draft_review', 'asset_comment', 'approval', 'reporting_view', 'delegated_operation',
]

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isModule(value: string): value is MarketingCollaborationModule {
  return Object.prototype.hasOwnProperty.call(MARKETING_COLLABORATION_CONTRACTS, value)
}

function isMode(value: string): value is MarketingCollaborationMode {
  return MODES.includes(value as MarketingCollaborationMode)
}

/**
 * POST /api/v1/cross-org/marketing/decide
 *
 * Audits a safe, named-user collaboration decision. Requesters select a module
 * and collaboration mode, never an arbitrary resource type/capability/action.
 * This endpoint does not publish, schedule, send, spend, launch, configure, or
 * change finance. Those remain module-owner flows with their own persisted
 * approval gates.
 */
export const POST = withCrmAuth('member', async (req: NextRequest, ctx: CrmAuthContext) => {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const moduleId = cleanString(body.module)
    const mode = cleanString(body.mode)
    const resourceId = cleanString(body.resourceId)
    const partnerLinkId = cleanString(body.partnerLinkId)
    const delegatedOperation = cleanString(body.delegatedOperation) || undefined

    if (!isModule(moduleId)) return apiError('module must be a supported marketing or analytics collaboration module', 400)
    if (!isMode(mode)) return apiError('mode must be a supported collaboration mode', 400)
    if (!resourceId) return apiError('resourceId is required', 400)
    if (!partnerLinkId || !partnerLinkId.startsWith('link-')) return apiError('partnerLinkId must reference a canonical partner link', 400)

    const resourceOwnerOrgId = await loadMarketingResourceOwner(moduleId, resourceId)
    if (!resourceOwnerOrgId) return apiError('The requested resource is unavailable for cross-organisation collaboration.', 404)

    let action
    try {
      action = resolveMarketingCollaborationAction(moduleId, mode, delegatedOperation)
    } catch (error) {
      if (error instanceof MarketingCollaborationPolicyError) return apiError(error.message, 403)
      throw error
    }
    if (action.humanApprovalRequired && ctx.isAgent) {
      return apiError('A human named-user approval is required; agents may prepare but cannot approve.', 403)
    }

    const result = await createCrossOrgPolicyService().decide({
      actor: { userId: ctx.actor.uid, orgId: ctx.orgId, platformAdmin: false },
      actorRef: ctx.actor,
      actorRole: ctx.role,
      resourceType: action.resourceType,
      resourceId,
      resourceOwnerOrgId,
      action: action.action,
      partnerLinkId,
      requiredCapability: action.requiredCapability,
      requireNamedUser: action.namedUserRequired,
      recordDecision: true,
    })

    return apiSuccess({
      ...result,
      collaboration: {
        module: moduleId,
        mode,
        action: action.action,
        namedUserRequired: action.namedUserRequired,
        humanApprovalRequired: action.humanApprovalRequired,
      },
    })
  } catch (error) {
    return apiErrorFromException(error)
  }
})
