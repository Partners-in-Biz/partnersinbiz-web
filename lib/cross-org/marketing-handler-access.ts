import type { NextRequest } from 'next/server'
import { resolveOrgScope } from '@/lib/api/orgScope'
import type { ApiUser } from '@/lib/api/types'
import {
  MARKETING_COLLABORATION_CONTRACTS,
  MarketingCollaborationPolicyError,
  resolveMarketingCollaborationAction,
  type MarketingCollaborationMode,
  type MarketingCollaborationModule,
} from '@/lib/cross-org/marketing-collaboration'
import {
  createCrossOrgPolicyService,
  type CrossOrgDecisionResult,
  type CrossOrgPolicyService,
} from '@/lib/cross-org/policy-service'

/**
 * Shared access seam for partner-facing marketing/analytics handlers.
 *
 * Owner-org members keep ordinary resolveOrgScope behaviour.
 * Foreign actors only enter through a named PartnerLink + CrossOrgPolicyService
 * decision against the allowlisted collaboration contract.
 * Owner-only side effects (publish/schedule/send/spend/launch/…) never cross
 * the organisation boundary — even if a grant exists.
 */

export const MARKETING_OWNER_ONLY_OPERATIONS = [
  'publish',
  'schedule',
  'send',
  'spend',
  'launch',
  'configure',
  'finance',
  'billing',
  'provider_config',
  'delete',
  'archive',
  'deploy',
] as const

export type MarketingOwnerOnlyOperation = (typeof MARKETING_OWNER_ONLY_OPERATIONS)[number]

export type MarketingHandlerOperation =
  | MarketingOwnerOnlyOperation
  | 'read'
  | 'write'
  | 'comment'
  | 'approve'
  | MarketingCollaborationMode
  | 'delegate_draft'
  | 'delegate_analyze'

export type MarketingHandlerAccessResult =
  | {
      ok: true
      access: 'owner'
      orgId: string
    }
  | {
      ok: true
      access: 'cross_org'
      orgId: string
      action: string
      decision: CrossOrgDecisionResult
    }
  | {
      ok: false
      status: 400 | 403 | 404
      error: string
      reason:
        | 'MISSING_OWNER_ORG'
        | 'OWNER_SCOPE_DENIED'
        | 'OWNER_ONLY_ACTION'
        | 'PARTNER_LINK_REQUIRED'
        | 'COLLABORATION_DENIED'
        | 'UNSUPPORTED_OPERATION'
        | 'HUMAN_APPROVAL_REQUIRED'
    }

export interface MarketingHandlerAccessInput {
  user: ApiUser
  module: MarketingCollaborationModule
  resourceId: string
  resourceOwnerOrgId: string | null | undefined
  operation: MarketingHandlerOperation
  /** Canonical PartnerLink id for foreign-org collaboration. */
  partnerLinkId?: string | null
  /** Optional delegated operation when operation is delegated_operation. */
  delegatedOperation?: string | null
  /** Injected in tests; production uses createCrossOrgPolicyService(). */
  policy?: Pick<CrossOrgPolicyService, 'decide'>
  /** When true, agents cannot take human-approval collaboration modes. */
  isAgent?: boolean
}

const OWNER_ONLY = new Set<string>(MARKETING_OWNER_ONLY_OPERATIONS)

function cleanPartnerLinkId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || !trimmed.startsWith('link-')) return null
  return trimmed
}

/** Read partner link from header, query, or JSON body field. */
export function extractPartnerLinkId(
  req?: NextRequest | null,
  body?: Record<string, unknown> | null,
): string | null {
  if (req) {
    const header = cleanPartnerLinkId(req.headers.get('x-partner-link-id'))
    if (header) return header
    try {
      const url = new URL(req.url)
      const fromQuery = cleanPartnerLinkId(url.searchParams.get('partnerLinkId'))
      if (fromQuery) return fromQuery
    } catch {
      // ignore malformed URLs; fall through to body/header already checked
      void 0
    }
  }
  if (body) {
    const fromBody = cleanPartnerLinkId(body.partnerLinkId)
    if (fromBody) return fromBody
  }
  return null
}

function isOwnerOnlyOperation(operation: MarketingHandlerOperation): operation is MarketingOwnerOnlyOperation {
  return OWNER_ONLY.has(operation)
}

function collaborationModeFor(
  operation: MarketingHandlerOperation,
  delegatedOperation?: string | null,
): { mode: MarketingCollaborationMode; delegatedOperation?: string } | null {
  if (
    operation === 'request_brief'
    || operation === 'draft_review'
    || operation === 'asset_comment'
    || operation === 'approval'
    || operation === 'reporting_view'
    || operation === 'delegated_operation'
  ) {
    return {
      mode: operation,
      delegatedOperation: delegatedOperation ?? undefined,
    }
  }
  // Convenience aliases used by handlers
  if (operation === 'read' || operation === 'write') {
    // Reads map to draft_review for content modules; analytics uses reporting_view.
    return null
  }
  if (operation === 'comment') return { mode: 'asset_comment' }
  if (operation === 'approve') return { mode: 'approval' }
  if (operation === 'delegate_draft') return { mode: 'delegated_operation', delegatedOperation: 'draft' }
  if (operation === 'delegate_analyze') return { mode: 'delegated_operation', delegatedOperation: 'analyze' }
  return null
}

function defaultCollaborationMode(
  module: MarketingCollaborationModule,
  operation: 'read' | 'write',
): MarketingCollaborationMode {
  const contract = MARKETING_COLLABORATION_CONTRACTS[module]
  if (operation === 'read') {
    if (contract.modes.reporting_view) return 'reporting_view'
    if (contract.modes.draft_review) return 'draft_review'
    return 'request_brief'
  }
  // write → draft collaboration only when the module allows it
  if (contract.modes.draft_review) return 'draft_review'
  if (contract.modes.delegated_operation) return 'delegated_operation'
  return 'request_brief'
}

/**
 * Enforce owner-org scope or a canonical cross-org collaboration decision.
 * Call after loading the resource so resourceOwnerOrgId is server-trusted.
 */
export async function assertMarketingHandlerAccess(
  input: MarketingHandlerAccessInput,
): Promise<MarketingHandlerAccessResult> {
  const ownerOrgId = typeof input.resourceOwnerOrgId === 'string' ? input.resourceOwnerOrgId.trim() : ''
  if (!ownerOrgId) {
    return {
      ok: false,
      status: 404,
      error: 'Resource not found',
      reason: 'MISSING_OWNER_ORG',
    }
  }

  // ── Owner-only side effects: never cross org ──────────────────────────────
  if (isOwnerOnlyOperation(input.operation)) {
    const scope = resolveOrgScope(input.user, ownerOrgId)
    if (!scope.ok) {
      return {
        ok: false,
        status: 403,
        error: `${input.operation} is owner-only and cannot be performed cross-organisation`,
        reason: 'OWNER_ONLY_ACTION',
      }
    }
    return { ok: true, access: 'owner', orgId: scope.orgId }
  }

  // ── Same-org / privileged owner path ──────────────────────────────────────
  const ownerScope = resolveOrgScope(input.user, ownerOrgId)
  if (ownerScope.ok) {
    return { ok: true, access: 'owner', orgId: ownerScope.orgId }
  }

  // ── Cross-org collaboration path ──────────────────────────────────────────
  const partnerLinkId = cleanPartnerLinkId(input.partnerLinkId)
  if (!partnerLinkId) {
    return {
      ok: false,
      status: ownerScope.status === 403 ? 403 : ownerScope.status,
      error: ownerScope.error || 'Partner link required for cross-organisation marketing access',
      reason: 'PARTNER_LINK_REQUIRED',
    }
  }

  const actorOrgId = typeof input.user.orgId === 'string' ? input.user.orgId.trim() : ''
  if (!actorOrgId) {
    return {
      ok: false,
      status: 403,
      error: 'Actor organisation is required for cross-organisation marketing access',
      reason: 'COLLABORATION_DENIED',
    }
  }

  let modeInfo = collaborationModeFor(input.operation, input.delegatedOperation)
  if (!modeInfo && (input.operation === 'read' || input.operation === 'write')) {
    const mode = defaultCollaborationMode(input.module, input.operation)
    modeInfo = {
      mode,
      delegatedOperation: mode === 'delegated_operation'
        ? (MARKETING_COLLABORATION_CONTRACTS[input.module].modes.delegated_operation?.delegatedOperation)
        : undefined,
    }
  }
  if (!modeInfo) {
    return {
      ok: false,
      status: 403,
      error: `${input.operation} is not a supported cross-organisation marketing operation`,
      reason: 'UNSUPPORTED_OPERATION',
    }
  }

  let resolved
  try {
    resolved = resolveMarketingCollaborationAction(
      input.module,
      modeInfo.mode,
      modeInfo.delegatedOperation,
    )
  } catch (error) {
    if (error instanceof MarketingCollaborationPolicyError) {
      const message = error.message
      const ownerOnly = /owner-only/i.test(message)
      return {
        ok: false,
        status: 403,
        error: message,
        reason: ownerOnly ? 'OWNER_ONLY_ACTION' : 'UNSUPPORTED_OPERATION',
      }
    }
    throw error
  }

  if (resolved.humanApprovalRequired && (input.isAgent || input.user.role === 'ai')) {
    return {
      ok: false,
      status: 403,
      error: 'A human named-user approval is required; agents may prepare but cannot approve.',
      reason: 'HUMAN_APPROVAL_REQUIRED',
    }
  }

  const policy = input.policy ?? createCrossOrgPolicyService()
  const decision = await policy.decide({
    actor: {
      userId: input.user.uid,
      orgId: actorOrgId,
      platformAdmin: input.user.role === 'admin',
    },
    resourceType: resolved.resourceType,
    resourceId: input.resourceId,
    resourceOwnerOrgId: ownerOrgId,
    action: resolved.action,
    partnerLinkId,
    requiredCapability: resolved.requiredCapability,
    requireNamedUser: resolved.namedUserRequired,
    recordDecision: false,
  })

  if (!decision.allowed) {
    return {
      ok: false,
      status: 403,
      error: decision.reason || 'Cross-organisation marketing access denied',
      reason: 'COLLABORATION_DENIED',
    }
  }

  return {
    ok: true,
    access: 'cross_org',
    orgId: actorOrgId,
    action: resolved.action,
    decision,
  }
}

/** True when every partner-facing marketing module has a real handler seam. */
export const MARKETING_HANDLER_POLICY_BOUND_MODULES: readonly MarketingCollaborationModule[] = [
  'campaigns',
  'social',
  'email',
  'seo',
  'ads',
  'analytics',
] as const
