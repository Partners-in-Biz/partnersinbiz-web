/**
 * Webhook types — outbound webhooks, queue items, deliveries.
 *
 * The Firestore-backed queue (`webhook_queue`) decouples event emission from
 * HTTP delivery; a cron-driven worker (see `lib/webhooks/worker.ts`) claims
 * pending items, signs the payload, POSTs to the subscriber URL, and records
 * each attempt as a `webhook_deliveries` audit doc.
 */

export type WebhookEvent =
  | 'invoice.created'
  | 'invoice.sent'
  | 'invoice.paid'
  | 'invoice.overdue'
  | 'quote.created'
  | 'quote.sent'
  | 'quote.accepted'
  | 'quote.rejected'
  | 'contact.created'
  | 'contact.updated'
  | 'deal.created'
  | 'deal.stage_changed'
  | 'deal.won'
  | 'deal.lost'
  | 'form.submitted'
  | 'payment.received'
  | 'expense.submitted'
  | 'task.completed'
  | 'property.created'
  | 'property.updated'
  | 'campaign.launched'

/**
 * List of valid event strings for runtime validation (e.g. POST body checks).
 * Kept in sync with the `WebhookEvent` union above.
 */
export const VALID_WEBHOOK_EVENTS: WebhookEvent[] = [
  'invoice.created',
  'invoice.sent',
  'invoice.paid',
  'invoice.overdue',
  'quote.created',
  'quote.sent',
  'quote.accepted',
  'quote.rejected',
  'contact.created',
  'contact.updated',
  'deal.created',
  'deal.stage_changed',
  'deal.won',
  'deal.lost',
  'form.submitted',
  'payment.received',
  'expense.submitted',
  'task.completed',
  'property.created',
  'property.updated',
  'campaign.launched',
]

export interface OutboundWebhook {
  id: string
  orgId: string
  name: string
  url: string
  events: WebhookEvent[]
  /** HMAC signing secret — returned once on create, redacted on reads. */
  secret: string
  active: boolean
  failureCount: number
  lastDeliveredAt: unknown | null
  lastFailureAt: unknown | null
  autoDisabledAt: unknown | null
  createdBy: string
  createdByType: 'user' | 'agent' | 'system'
  createdAt: unknown
  updatedAt: unknown
  deleted: boolean
}

export type QueueStatus = 'pending' | 'delivering' | 'delivered' | 'failed'

export interface WebhookQueueItem {
  id: string
  webhookId: string
  orgId: string
  event: WebhookEvent | 'test'
  payload: Record<string, unknown>
  status: QueueStatus
  retryCount: number
  /** Firestore Timestamp — the next time the worker should attempt delivery. */
  nextAttemptAt: unknown
  createdAt: unknown
  claimedAt: unknown | null
}

export interface WebhookDelivery {
  id: string
  webhookId: string
  queueItemId: string
  event: WebhookEvent | 'test'
  /** sha256 of the stringified payload (hex). */
  payloadHash: string
  responseStatus: number | null
  responseHeaders: Record<string, string>
  /** Truncated to 2KB. */
  responseBody: string
  durationMs: number
  attemptNumber: number
  deliveredAt: unknown
  error: string | null
}

/**
 * Retry backoff schedule in milliseconds, indexed by `retryCount`.
 *
 * index 0 = first attempt (no wait), then 30s, 2m, 10m, 1h, 6h.
 * After attempt index 5 fails the item is marked `failed` and the webhook's
 * `failureCount` increments.
 */
export const WEBHOOK_RETRY_BACKOFF_MS: readonly number[] = [
  0,
  30_000,
  120_000,
  600_000,
  3_600_000,
  21_600_000,
]

/** After this many consecutive webhook-level failures, auto-disable. */
export const WEBHOOK_AUTO_DISABLE_THRESHOLD = 10

/** Max retry attempts per queue item before marking failed. */
export const WEBHOOK_MAX_RETRIES = 5
