/**
 * lib/observability/error-log.ts
 *
 * Lightweight error/event logger that writes to the `error_events` Firestore
 * collection. This is the canonical source surfaced by
 * GET /api/v1/admin/system/logs (US-267).
 *
 * Call `logErrorEvent(...)` from any server-side code path that catches an
 * error worth surfacing in the admin error log. Writes are best-effort and
 * never throw — a logging failure must not break the calling request.
 *
 * Document shape (collection `error_events`):
 *   {
 *     message:    string                 // human-readable error message
 *     stack:      string | null          // captured stack trace (optional)
 *     severity:   'info'|'warning'|'error'|'critical'
 *     orgId:      string | null          // tenant scope, if known
 *     source:     string                 // logical subsystem ('api','webhook','agent',...)
 *     route:      string | null          // request path that produced it
 *     resolvedAt: Timestamp | null       // set when an admin resolves it
 *     assignedTo: string | null          // uid the event is assigned to
 *     createdAt:  Timestamp              // server timestamp
 *   }
 */

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical'

export const ERROR_SEVERITIES: ErrorSeverity[] = ['info', 'warning', 'error', 'critical']

export const ERROR_EVENTS_COLLECTION = 'error_events'

export interface LogErrorEventInput {
  message: string
  stack?: string | null
  severity?: ErrorSeverity
  orgId?: string | null
  source?: string
  route?: string | null
  /** Caught error — if provided and no explicit message/stack, they are derived from it. */
  error?: unknown
}

function normalizeSeverity(value: unknown): ErrorSeverity {
  return ERROR_SEVERITIES.includes(value as ErrorSeverity) ? (value as ErrorSeverity) : 'error'
}

/**
 * Persist an error event. Best-effort: returns the new doc id, or null on
 * failure (logging must never break the caller).
 */
export async function logErrorEvent(input: LogErrorEventInput): Promise<string | null> {
  try {
    const derived = input.error instanceof Error ? input.error : undefined
    const message = (input.message ?? derived?.message ?? 'Unknown error').toString().slice(0, 4000)
    const stack = (input.stack ?? derived?.stack ?? null)?.toString().slice(0, 12000) ?? null

    const doc = {
      message,
      stack,
      severity: normalizeSeverity(input.severity),
      orgId: input.orgId ?? null,
      source: (input.source ?? 'app').toString().slice(0, 120),
      route: input.route ?? null,
      resolvedAt: null,
      assignedTo: null,
      createdAt: FieldValue.serverTimestamp(),
    }

    const ref = await adminDb.collection(ERROR_EVENTS_COLLECTION).add(doc)
    return ref.id
  } catch (err) {
    // Never throw from the logger.
    console.error('[logErrorEvent] failed to persist error event', err)
    return null
  }
}
