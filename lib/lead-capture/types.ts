// lib/lead-capture/types.ts
//
// Lead capture is the "outside-in" entry point for an org's CRM:
//   - A `LeadCaptureSource` describes one capture surface (a newsletter
//     signup, a lead magnet, a contact form, an embedded widget...). It
//     owns its own fields, theming, auto-enrollment rules, and an
//     optional double-opt-in (DOI) flow.
//   - A `LeadCaptureSubmission` is one form submission against a source.
//     It always creates-or-merges into the `contacts` collection; if DOI
//     is enabled, enrollment is deferred until the confirmation link is
//     clicked.
//
// This is intentionally separate from the older `lib/crm/captureSources.ts`
// system, which is keyed by an opaque `publicKey` and has a simpler schema.
// The newer system uses the doc id as the public identifier and exposes a
// full embeddable widget. Firestore collections used:
//   - lead_capture_sources
//   - lead_capture_submissions

import type { Timestamp } from 'firebase-admin/firestore'

export type CaptureSourceType =
  | 'newsletter'
  | 'lead-magnet'
  | 'contact-form'
  | 'embed-widget'
  | 'api'

export type DoubleOptInMode = 'off' | 'on'

export type CaptureFieldType = 'text' | 'email' | 'tel' | 'textarea' | 'select'

export interface CaptureField {
  key: string                // e.g. "firstName", "company"
  label: string
  type: CaptureFieldType
  required: boolean
  options?: string[]         // for select
  placeholder?: string
}

export interface CaptureWidgetTheme {
  primaryColor: string
  textColor: string
  backgroundColor: string
  borderRadius: number
  buttonText: string
  headingText: string
  subheadingText: string
}

export const DEFAULT_WIDGET_THEME: CaptureWidgetTheme = {
  primaryColor: '#0f766e',
  textColor: '#111827',
  backgroundColor: '#ffffff',
  borderRadius: 12,
  buttonText: 'Subscribe',
  headingText: 'Join our newsletter',
  subheadingText: 'Get the latest updates straight to your inbox.',
}

export interface CaptureSourceRateLimit {
  enabled: boolean
  maxPerHourPerIp: number
  maxPerDayPerEmail: number
}

export interface CaptureSourceBlockStats {
  honeypot: number
  rateLimit: number
  disposable: number
  captcha: number
}

export interface CaptureSourceStats {
  blocked: CaptureSourceBlockStats
}

export const DEFAULT_RATE_LIMIT: CaptureSourceRateLimit = {
  enabled: true,
  maxPerHourPerIp: 10,
  maxPerDayPerEmail: 3,
}

export const DEFAULT_BLOCK_STATS: CaptureSourceBlockStats = {
  honeypot: 0,
  rateLimit: 0,
  disposable: 0,
  captcha: 0,
}

// ─── Widget display modes ───────────────────────────────────────────────────
//
// The embed widget can render in five display modes. `inline` is the legacy
// behaviour (form renders next to the script tag). The other four wrap the
// same form in different presentation chrome (modal, toaster, exit-intent
// modal, or multi-step wizard) with shared triggering + frequency rules.
//
// All new fields are optional so existing sources without a `display` config
// continue to behave as inline forms.

export type WidgetDisplayMode =
  | 'inline'
  | 'popup'
  | 'slide-in'
  | 'exit-intent'
  | 'multi-step'

export type WidgetPosition =
  | 'center'
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left'

export interface WidgetDisplayStep {
  headingText: string
  subheadingText: string
  fields: string[]           // field keys from source.fields to show on this step
  buttonText: string
}

export interface WidgetDisplayConfig {
  mode: WidgetDisplayMode
  // Popup / slide-in / exit-intent triggers
  triggerDelaySeconds?: number             // show after N seconds on page
  triggerScrollPercent?: number            // show after scrolling N% of page
  triggerPagesViewed?: number              // show only after N pageviews (sessionStorage)
  triggerOnExitIntent?: boolean            // for popup/slide-in: also fire on exit-intent
  // Don't pester
  dismissCooldownDays?: number             // after dismiss, suppress for N days (default 7)
  suppressForSubscribedDays?: number       // after signup, suppress for N days (default 365)
  showOnPaths?: string[]                   // glob patterns; empty = all pages
  hideOnPaths?: string[]                   // glob patterns; takes precedence over showOnPaths
  // Positioning (popup uses 'center' by default; slide-in defaults bottom-right)
  position?: WidgetPosition
  // Multi-step config
  steps?: WidgetDisplayStep[]
}

export const DEFAULT_DISPLAY_CONFIG: WidgetDisplayConfig = {
  mode: 'inline',
}

export interface CaptureSource {
  id: string
  orgId: string
  name: string                       // human label
  type: CaptureSourceType
  doubleOptIn: DoubleOptInMode
  confirmationSubject?: string       // DOI email subject
  confirmationBodyHtml?: string      // DOI email body with {{confirmUrl}} placeholder
  successMessage: string             // shown to user after submit
  successRedirectUrl?: string        // optional redirect on success
  fields: CaptureField[]             // beyond email (which is always required)
  tagsToApply: string[]              // tags applied to created/updated contact
  campaignIdsToEnroll: string[]      // direct campaign auto-enrollment
  sequenceIdsToEnroll: string[]      // direct sequence auto-enrollment
  notifyEmails: string[]             // notify org admins of new submissions
  widgetTheme: CaptureWidgetTheme
  active: boolean
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  deleted?: boolean

  // Spam protection
  turnstileEnabled: boolean          // gate submissions behind Cloudflare Turnstile
  turnstileSiteKey: string           // public site key, safe to embed in widget JS
  honeypotEnabled: boolean           // default true — adds a hidden _hp field, silent reject if filled
  blockDisposableEmails: boolean     // reject mailinator.com / tempmail / etc.
  rateLimit: CaptureSourceRateLimit
  stats?: CaptureSourceStats         // counter of blocked attempts by reason

  // Widget display + triggers (optional — absence means classic inline mode)
  display?: WidgetDisplayConfig

  // Outbound webhook (US-091): fired after a submission creates/updates a
  // contact. Delivery is async + retried; never blocks the submit response.
  // Absence (empty string) means no webhook is configured.
  webhookUrl?: string                // https endpoint to POST submissions to
  webhookSecret?: string             // optional shared secret → HMAC-SHA256 signature header
}

// ─── Outbound webhook deliveries (US-091) ────────────────────────────────────
//
// Every webhook delivery attempt is logged to the top-level
// `capture_webhook_deliveries` collection (queryable per source) AND mirrored
// into a `deliveries` subcollection under the source doc for quick UI reads.
// Each document records the final outcome of a single submission's delivery
// (after all retry attempts) plus a per-attempt breakdown.

export type WebhookDeliveryStatus = 'success' | 'failed'

export interface WebhookDeliveryAttempt {
  attempt: number                    // 1-based attempt number
  ok: boolean                        // 2xx response
  statusCode: number | null          // HTTP status, null on network/timeout error
  error: string | null               // error message when the attempt failed
  durationMs: number                 // wall-clock time for this attempt
  at: string                         // ISO timestamp of this attempt
}

export interface WebhookDelivery {
  id: string
  orgId: string
  captureSourceId: string
  submissionId: string
  contactId: string
  url: string                        // destination (redacted of query secrets if any)
  event: string                      // 'capture.submission'
  status: WebhookDeliveryStatus      // final outcome across all attempts
  statusCode: number | null          // status of the last attempt
  attempts: WebhookDeliveryAttempt[] // per-attempt log
  attemptCount: number
  lastError: string | null
  createdAt: Timestamp | null        // when delivery started
  completedAt: Timestamp | null      // when delivery finished (success or gave up)
}

export const CAPTURE_WEBHOOK_DELIVERIES = 'capture_webhook_deliveries'

export type CaptureSourceInput = Omit<
  CaptureSource,
  'id' | 'createdAt' | 'updatedAt'
>

export interface CaptureSubmission {
  id: string
  orgId: string
  captureSourceId: string
  email: string
  data: Record<string, string>       // submitted form fields
  contactId: string                  // contact created/updated
  confirmedAt: Timestamp | null      // null until DOI confirmed (or set immediately if DOI off)
  confirmationToken: string          // HMAC for DOI link
  ipAddress: string
  userAgent: string
  referer: string
  createdAt: Timestamp | null
  // Multi-step / progressive profiling — present when the submission was
  // created by a multi-step widget. `currentStep` is the last step the user
  // completed (0-indexed). `completedSteps` is true once the final step has
  // been posted (auto-enroll + DOI fire on that transition).
  currentStep?: number
  completedSteps?: boolean
}

export const VALID_CAPTURE_TYPES: CaptureSourceType[] = [
  'newsletter',
  'lead-magnet',
  'contact-form',
  'embed-widget',
  'api',
]

export const VALID_FIELD_TYPES: CaptureFieldType[] = [
  'text',
  'email',
  'tel',
  'textarea',
  'select',
]

export const LEAD_CAPTURE_SOURCES = 'lead_capture_sources'
export const LEAD_CAPTURE_SUBMISSIONS = 'lead_capture_submissions'
