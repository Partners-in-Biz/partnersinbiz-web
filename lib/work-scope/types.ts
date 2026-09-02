/**
 * Generic work-scope for org / company / personal records.
 * Marketing owner helpers in lib/social/account-scope.ts are the historical
 * source; this module is the canonical vocabulary for every product surface.
 */

export type WorkOwnerKind = 'org' | 'company' | 'personal'

export type WorkScope = {
  owner: WorkOwnerKind
  uid?: string
  companyId?: string
}

/** Per-record override for linked-org projection. Unset = shared. */
export type ClientVisibility = 'shared' | 'private'

export const CLIENT_VISIBILITY_FIELD = 'clientVisibility' as const

export type WorkScopeRecord = {
  accountScope?: unknown
  ownerUid?: unknown
  companyId?: unknown
  marketingOwner?: unknown
  workOwner?: unknown
  clientVisibility?: unknown
}
