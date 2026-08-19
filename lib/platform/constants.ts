// Platform-wide constants used across CRM, email, sequences, and campaigns.

// Doc id of the Partners in Biz "platform_owner" org. Used as the default
// orgId for legacy / platform-level data (PIB enquiries, system emails).
export const PIB_PLATFORM_ORG_ID = 'pib-platform-owner'

// Shared sender defaults — used when a campaign has no verified per-org
// EmailDomain configured. Local-part is the convention; domain comes from
// SHARED_SENDER_DOMAIN.
export const SHARED_SENDER_DOMAIN = 'partnersinbiz.online'
export const SHARED_SENDER_LOCAL = 'campaigns'
export const SHARED_SENDER_NAME = 'Partners in Biz'
