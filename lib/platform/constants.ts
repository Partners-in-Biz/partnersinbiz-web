// Platform-wide constants used across CRM, email, sequences, and campaigns.

// Doc id of the Partners in Biz "platform_owner" org. Used as the default
// orgId for legacy / platform-level data (PIB enquiries, system emails).
export const PIB_PLATFORM_ORG_ID = 'pib-platform-owner'

// Platform-owned product portal org IDs. These orgs should appear in the
// workspace switcher for platform team members (alongside the platform_owner org).
// Other client orgs where team members happen to be added should not appear.
export const PLATFORM_PRODUCT_ORG_IDS = [
  'HqXE3ZfSXT1CapxoKzFQ', // Lumen Speeds
  'yjM1I2DW6smOs5QdlWiP', // Velox Math
]

// Shared sender defaults — used when a campaign has no verified per-org
// EmailDomain configured. Local-part is the convention; domain comes from
// SHARED_SENDER_DOMAIN.
export const SHARED_SENDER_DOMAIN = 'partnersinbiz.online'
export const SHARED_SENDER_LOCAL = 'campaigns'
export const SHARED_SENDER_NAME = 'Partners in Biz'
