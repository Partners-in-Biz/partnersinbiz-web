// lib/ads/conversions/types.ts
import type { AdConversionPlatform } from '@/lib/ads/types'

/** Cross-platform conversion event input — translated to Meta CAPI, Google Enhanced Conversions, or LinkedIn CAPI */
export interface ConversionEventInput {
  orgId: string
  /** Canonical Conversion Action ID — looks up doc to discover platform + per-platform resource */
  conversionActionId: string
  /** Unique event ID for dedupe (also used as Meta event_id + Google order_id + LinkedIn eventId) */
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
  }
  /** For Google — Google Click ID, takes precedence over user identifiers when present */
  gclid?: string
  /** For LinkedIn — first-party ads tracking cookie (li_fat_id). Sent raw (NOT hashed). */
  liFatId?: string
  /** Extra metadata — passed through to Meta CAPI custom_data */
  customData?: Record<string, unknown>
}

export interface ConversionFanoutResult {
  /** 'sent' if the platform's fanout succeeded, 'failed' if it threw, 'skipped' if not configured */
  meta?: 'sent' | 'failed' | 'skipped'
  google?: 'sent' | 'failed' | 'skipped'
  linkedin?: 'sent' | 'failed' | 'skipped'
  /** Per-platform error message when 'failed' */
  metaError?: string
  googleError?: string
  linkedinError?: string
}

// Re-export for convenience
export type { AdConversionPlatform }
