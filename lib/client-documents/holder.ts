/**
 * Client document holder model (Partners in Biz)
 *
 * 1. **Holder org (`orgId`)** = the organisation that owns/workspace-holds the document.
 *    For PiB commercial work this is almost always `pib-platform-owner`.
 *    The document lives under us until we publish / send it.
 *
 * 2. **Target client** = `linked.companyId` / `linked.clientOrgId` (who it is *for*).
 *    Linking a client does NOT move holder ownership to the client org.
 *
 * 3. **`createdBy`** = Firebase uid of the human who requested the create
 *    (user-delegation: the person who asked the agent). Never a display name.
 *    Agent assist is only on `createdByAgentId`.
 *
 * 4. **Visibility**
 *    - `internal_draft` / `internal_review`: holder-team only (creator, shares, holder org members)
 *    - client-facing statuses: also recipients on linked client org (per status + permissions)
 */

import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import type { ClientDocumentStatus } from './types'

export const DOCUMENT_CLIENT_FACING_STATUSES = new Set<ClientDocumentStatus>([
  'client_review',
  'changes_requested',
  'approved',
  'accepted',
])

export const DOCUMENT_INTERNAL_STATUSES = new Set<ClientDocumentStatus>([
  'internal_draft',
  'internal_review',
])

export function isDocumentClientFacingStatus(status: unknown): boolean {
  return typeof status === 'string' && DOCUMENT_CLIENT_FACING_STATUSES.has(status as ClientDocumentStatus)
}

export function isDocumentInternalStatus(status: unknown): boolean {
  return typeof status === 'string' && DOCUMENT_INTERNAL_STATUSES.has(status as ClientDocumentStatus)
}

/**
 * Resolve the holder org for a new document.
 * Prefer platform when the work is for a platform CRM company or a client org
 * that already maps to a platform company record.
 */
export function resolveDocumentHolderOrgId(input: {
  /** Explicit org from the request after scope resolution */
  requestedOrgId?: string | null
  /** Platform company id if requestedOrgId is a client org with a CRM mirror */
  platformCompanyIdForClientOrg?: string | null
  /** Company record when creating via companyId */
  linkedCompany?: { id: string; orgId: string; linkedOrgId?: string } | null
  /** Fallback when no better signal (creator workspace) */
  creatorHomeOrgId?: string | null
}): string | undefined {
  // Creating in/for a client org that has a platform company → hold on platform
  if (input.platformCompanyIdForClientOrg) {
    return PIB_PLATFORM_ORG_ID
  }

  // Creating against a CRM company that already lives on a holder org
  if (input.linkedCompany?.orgId) {
    return input.linkedCompany.orgId.trim() || undefined
  }

  const requested = (input.requestedOrgId || '').trim()
  if (requested) return requested

  const home = (input.creatorHomeOrgId || '').trim()
  return home || undefined
}

/**
 * Resolve the recipient client org for a document.
 *
 * When the holder is the PiB platform workspace, linked.clientOrgId must be a
 * real client org — never pib-platform-owner (that made client_review docs
 * invisible to the linked organisation while still "published").
 *
 * When the holder is already a client org, the recipient may equal the holder.
 */
export function resolveDocumentRecipientClientOrgId(input: {
  holderOrgId?: string | null
  linkedClientOrgId?: string | null
  linkedClientOrgIds?: string[] | null
  companyLinkedOrgId?: string | null
}): string | undefined {
  const holder = (input.holderOrgId || '').trim()
  const platformHolder = holder === PIB_PLATFORM_ORG_ID
  const companyLinked = (input.companyLinkedOrgId || '').trim()
  if (companyLinked && (!platformHolder || companyLinked !== PIB_PLATFORM_ORG_ID)) {
    return companyLinked
  }

  const candidates = [
    (input.linkedClientOrgId || '').trim(),
    ...((input.linkedClientOrgIds ?? []).map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)),
  ]
  for (const id of candidates) {
    if (!id) continue
    if (platformHolder && id === PIB_PLATFORM_ORG_ID) continue
    return id
  }
  return undefined
}

/** Client-facing recipient orgs, excluding accidental platform-as-recipient stamps. */
export function sanitizeRecipientClientOrgIds(
  holderOrgId: string | null | undefined,
  clientOrgIds: string[],
): string[] {
  const holder = (holderOrgId || '').trim()
  const platformHolder = holder === PIB_PLATFORM_ORG_ID
  return Array.from(new Set(
    clientOrgIds
      .map((id) => (typeof id === 'string' ? id.trim() : ''))
      .filter((id) => Boolean(id) && !(platformHolder && id === PIB_PLATFORM_ORG_ID)),
  ))
}
