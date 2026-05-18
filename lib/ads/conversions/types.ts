// lib/ads/conversions/types.ts
import type { AdConversionPlatform } from '@/lib/ads/types'

/** Cross-platform conversion event input — translated to Meta CAPI, Google Enhanced Conversions, or LinkedIn CAPI */
export interface ConversionEventInput {
  orgId: string
  /** Canonical Conversion Action ID — looks up doc to discover platform + per-platform resource */
  conversionActionId: string
  /** Unique event ID for dedupe (also used as Meta event_id + Google order_id + LinkedIn eventId + TikTok event_id) */
  eventId: string
  /** When the conversion happened */
  eventTime: Date
  value?: number
  currency?: string
  user: {
    email?: string
    phone?: string
    firstName?: string
    lastName?: string
    countryCode?: string
    postalCode?: string
    /** For TikTok — stable external identifier (will be SHA-256 hashed server-side) */
    externalId?: string
  }
  /** For Google — Google Click ID, takes precedence over user identifiers when present */
  gclid?: string
  /** For LinkedIn — first-party ads tracking cookie (li_fat_id). Sent raw (NOT hashed). */
  liFatId?: string
  /** For TikTok — TikTok click ID from URL parameter (?ttclid=…). Sent raw (NOT hashed). */
  ttclid?: string
  /** For TikTok — first-party TikTok cookie (_ttp). Sent raw (NOT hashed). */
  ttp?: string
  /** Extra metadata — passed through to Meta CAPI custom_data */
  customData?: Record<string, unknown>
}

export interface ConversionFanoutResult {
  /** 'sent' if the platform's fanout succeeded, 'failed' if it threw, 'skipped' if not configured */
  meta?: 'sent' | 'failed' | 'skipped'
  google?: 'sent' | 'failed' | 'skipped'
  linkedin?: 'sent' | 'failed' | 'skipped'
  tiktok?: 'sent' | 'failed' | 'skipped'
  /** Per-platform error message when 'failed' */
  metaError?: string
  googleError?: string
  linkedinError?: string
  tiktokError?: string
}

// Re-export for convenience
export type { AdConversionPlatform }
