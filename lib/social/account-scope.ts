/**
 * Social-account and campaign identity helpers.
 * Generic org/company/personal work-scope lives in lib/work-scope.
 * This barrel re-exports core + work-scope adapters for existing importers.
 */

export {
  PERSONAL_SCOPE,
  ORG_SCOPE,
  isPersonalAccountRecord,
  isCompanyAccountType,
  isCompanyPagePlatform,
  isCompanyLinkedAccount,
  isPersonalCampaignRecord,
  canAccessCampaign,
  recordCompanyId,
  accountVisibleForWorkspace,
  accountAllowedForPublish,
  storedAccountTypeForScope,
} from './account-scope-core'

export {
  brandKitDocId,
  companyFieldsForWrite,
  ownerFieldsForWrite,
  resolveMarketingOwnerFromValues,
  resolveMarketingOwnerFromSearchParams,
  recordVisibleForOwner,
  campaignVisibleForScope,
  type MarketingOwnerKind,
  type MarketingOwnerContext,
} from './account-scope-work'
