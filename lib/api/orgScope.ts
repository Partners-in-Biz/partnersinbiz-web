// lib/api/orgScope.ts
//
// Per-role orgId resolution. Used by routes that are open to both `admin`
// and `client` roles to ensure clients can only access their own org's data.
//
// Security fix 2026-08-21: Portal workspace isolation for dual-role platform owners.
//
// PROBLEM: Platform admins with activeOrgId (portal workspace context) were allowed
// to pass any orgId param, bypassing workspace isolation. This affected client-documents
// and other routes using resolveOrgScope.
//
// FIX: When activeOrgId is present (portal workspace context), enforce it as the ONLY
// accessible org, regardless of role. Platform admins in a client workspace must see
// ONLY that workspace's data.
//
// Behaviour:
//   - Portal workspace context (activeOrgId present): ALL roles must use activeOrgId.
//     Explicit orgId param must match activeOrgId or be omitted.
//   - Admin / ai WITHOUT activeOrgId: can pass any `?orgId=` (API/cron usage).
//   - Client roles: MUST use the orgId from their user record (activeOrgId > orgId).
//     If a `?orgId=` is supplied and it doesn't match, return 403.
//   - If neither side supplies an orgId, return 400 with a helpful message.

import type { ApiUser } from './types'
import { canAccessOrg } from './platformAdmin'
import { resolveSelectedOrgContext } from './selectedOrgContext'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

export interface OrgScopeOk {
  ok: true
  orgId: string
}

export interface OrgScopeErr {
  ok: false
  status: 400 | 403
  error: string
}

export type OrgScopeResult = OrgScopeOk | OrgScopeErr

/**
 * Resolve the orgId for a request given the authenticated user and an
 * optional orgId from the URL/query/body.
 *
 * Pass `null` for `requestedOrgId` if the route doesn't accept one (rare —
 * most list endpoints take `?orgId=`).
 */
export function resolveOrgScope(user: ApiUser, requestedOrgId: string | null): OrgScopeResult {
  // Security: Portal workspace detection.
  // When activeOrgId is present, the user is in a portal workspace context.
  // Enforce workspace isolation for ALL roles (including platform admins).
  const portalWorkspaceOrgId = user.activeOrgId
  
  // Portal workspace context: enforce client-like scoping for ALL roles.
  // This is the ONLY new restriction added by the security fix.
  if (portalWorkspaceOrgId) {
    // If an orgId was explicitly requested, it MUST match the active workspace.
    // This blocks platform admins from accessing other orgs via query params
    // while sitting in a client workspace.
    if (requestedOrgId && requestedOrgId !== portalWorkspaceOrgId) {
      return { ok: false, status: 403, error: 'Cannot access a different organisation from portal workspace' }
    }
    // Verify the user actually has access to the portal workspace org.
    if (!canAccessOrg(user, portalWorkspaceOrgId)) {
      return { ok: false, status: 403, error: 'You do not have access to this workspace' }
    }
    return { ok: true, orgId: portalWorkspaceOrgId }
  }

  // Admin / ai WITHOUT portal context: original pre-fix behavior restored.
  // For list endpoints that require explicit ?orgId=, the endpoint validates it.
  // For document-access checks, requestedOrgId is the document's orgId.
  if (user.role === 'admin' || user.role === 'ai') {
    // If no orgId provided, this is likely a list endpoint - let it handle the error
    if (!requestedOrgId) {
      return { ok: false, status: 400, error: 'orgId is required' }
    }
    // AI agents and unrestricted admins can access any org
    // Restricted admins checked via canAccessOrg
    if (!canAccessOrg(user, requestedOrgId)) {
      return { ok: false, status: 403, error: 'You do not have access to this organisation' }
    }
    return { ok: true, orgId: requestedOrgId }
  }

  const selectedContext = resolveSelectedOrgContext(user, requestedOrgId)
  if (!selectedContext.ok) return selectedContext
  return { ok: true, orgId: selectedContext.orgId }
}
