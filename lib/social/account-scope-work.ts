/**
 * Work-scope adapters kept under the social/account-scope import path so
 * existing marketing callers keep compiling without a mass import rewrite.
 */
import {
  brandKitDocId as workBrandKitDocId,
  companyFieldsForWrite as workCompanyFieldsForWrite,
  recordVisibleForWorkScope,
  resolveWorkScope,
  resolveWorkScopeFromSearchParams,
  workScopeFieldsForWrite,
  type WorkScope,
} from '@/lib/work-scope'
import { isPersonalCampaignRecord } from './account-scope-core'

/** @deprecated Prefer WorkScope / resolveWorkScope. */
export type MarketingOwnerKind = WorkScope['owner']
/** @deprecated Prefer WorkScope. */
export type MarketingOwnerContext = WorkScope

export function brandKitDocId(orgId: string, owner: WorkScope): string {
  return workBrandKitDocId(orgId, owner)
}

export function ownerFieldsForWrite(owner: WorkScope): Record<string, unknown> {
  return workScopeFieldsForWrite(owner)
}

export function companyFieldsForWrite(companyId?: unknown): Record<string, unknown> {
  return workCompanyFieldsForWrite(companyId)
}

export function resolveMarketingOwnerFromValues(input: {
  personal?: boolean
  scope?: unknown
  companyId?: unknown
  sourceCompanyId?: unknown
  uid?: string
}): WorkScope {
  return resolveWorkScope(input)
}

export function resolveMarketingOwnerFromSearchParams(
  searchParams: URLSearchParams,
  uid?: string,
): WorkScope {
  return resolveWorkScopeFromSearchParams(searchParams, uid)
}

/**
 * Org view includes company-stamped rows (badge in UI).
 * Social accounts keep accountVisibleForWorkspace (no leak of company identities).
 */
export function recordVisibleForOwner(
  record: {
    accountScope?: unknown
    ownerUid?: unknown
    companyId?: unknown
    marketingOwner?: unknown
  },
  owner: WorkScope,
): boolean {
  return recordVisibleForWorkScope(record, owner, { orgViewIncludesCompany: true })
}

export function campaignVisibleForScope(
  campaign: object,
  options: { personal: boolean; uid: string; companyId?: string },
): boolean {
  if (options.personal) {
    return recordVisibleForWorkScope(campaign as { accountScope?: unknown; ownerUid?: unknown }, {
      owner: 'personal',
      uid: options.uid,
    })
  }
  if (isPersonalCampaignRecord(campaign)) return false
  return recordVisibleForWorkScope(campaign as { accountScope?: unknown; companyId?: unknown }, {
    owner: options.companyId ? 'company' : 'org',
    ...(options.companyId ? { companyId: options.companyId } : {}),
  }, { orgViewIncludesCompany: true })
}
