// lib/email/bounceTracking.ts
//
// Durable soft-bounce counter per (orgId, email). Resend reports each soft
// (transient) bounce independently, but a recipient that keeps soft-bouncing
// is effectively undeliverable. We aggregate soft bounces in a rolling window
// and, on the Nth soft bounce, escalate to a HARD bounce — a permanent
// suppression plus contact.bouncedAt, counted as a hard bounce in stats.
//
// Storage: Firestore `email_bounce_tracking/{orgId}__{emailHash}`.
//   • emailHash is a sha256 of the lowercased address (keeps the doc id
//     safe — emails contain characters Firestore disallows in ids, e.g. '/').
//   • The doc holds a running soft-bounce `count`, `firstBounceAt`,
//     `lastBounceAt`, the plaintext `email`/`orgId` (for audit + queries) and
//     a de-dup guard keyed on the provider message id so the same webhook
//     delivery can't double-count.
//
// Idempotency: Resend can retry webhook deliveries. We pass the provider
// `emailId` for the bounce event and skip the increment when the same id was
// already recorded as the most-recent bounce. This keeps the counter honest
// without an unbounded de-dup set.

import { createHash } from 'crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { normalizeEmail } from './suppressions'

const COLLECTION = 'email_bounce_tracking'

// Number of soft bounces within the rolling window that escalates to a hard
// bounce. The 3rd soft bounce escalates (i.e. threshold reached at count === 3).
export const SOFT_BOUNCE_ESCALATION_THRESHOLD = 3

// Rolling window. Soft bounces older than this don't count toward escalation —
// the counter resets when the previous soft bounce is outside the window.
export const SOFT_BOUNCE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export interface SoftBounceTrackingDoc {
  orgId: string
  email: string
  count: number
  firstBounceAt: Timestamp | null
  lastBounceAt: Timestamp | null
  lastEmailId: string // provider message id of the most-recent counted bounce (de-dup guard)
  escalatedAt: Timestamp | null
}

export interface RecordSoftBounceResult {
  // Running soft-bounce count within the active window AFTER this bounce.
  count: number
  // True when this bounce pushed the count to the escalation threshold and the
  // address should now be treated as a hard bounce.
  escalate: boolean
  // True when the increment was skipped because this exact emailId was already
  // counted (idempotent webhook retry).
  duplicate: boolean
}

function emailHash(email: string): string {
  return createHash('sha256').update(normalizeEmail(email)).digest('hex').slice(0, 32)
}

export function bounceTrackingDocId(orgId: string, email: string): string {
  return `${orgId}__${emailHash(email)}`
}

/**
 * Record a soft bounce for (orgId, email) and report whether it escalates to a
 * hard bounce.
 *
 * Behaviour:
 *   • Resets the counter to 1 when there is no prior soft bounce, or when the
 *     previous one is outside the rolling window.
 *   • Otherwise increments the running count.
 *   • Returns escalate=true exactly when the (windowed) count reaches the
 *     escalation threshold. Once escalated we stamp `escalatedAt` so a later
 *     soft bounce for the same address doesn't re-escalate spuriously — but we
 *     still return escalate=true if it somehow lands on the threshold again
 *     after a window reset (defensive; the suppression upsert is idempotent).
 *   • Idempotent on `emailId`: a repeated webhook delivery for the same bounce
 *     event is a no-op (duplicate=true).
 *
 * Runs in a transaction so concurrent webhook deliveries don't race the count.
 */
export async function recordSoftBounce(input: {
  orgId: string
  email: string
  emailId: string
}): Promise<RecordSoftBounceResult> {
  const orgId = input.orgId
  const email = normalizeEmail(input.email)
  const emailId = (input.emailId ?? '').trim()
  if (!orgId || !email) {
    return { count: 0, escalate: false, duplicate: false }
  }

  const ref = adminDb.collection(COLLECTION).doc(bounceTrackingDocId(orgId, email))

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const now = Date.now()

    if (!snap.exists) {
      tx.set(ref, {
        orgId,
        email,
        count: 1,
        firstBounceAt: FieldValue.serverTimestamp(),
        lastBounceAt: FieldValue.serverTimestamp(),
        lastEmailId: emailId,
        escalatedAt: null,
      })
      return {
        count: 1,
        escalate: SOFT_BOUNCE_ESCALATION_THRESHOLD <= 1,
        duplicate: false,
      }
    }

    const data = (snap.data() ?? {}) as Partial<SoftBounceTrackingDoc>

    // Idempotency guard: same provider event already counted.
    if (emailId && data.lastEmailId === emailId) {
      return { count: data.count ?? 0, escalate: false, duplicate: true }
    }

    const lastMs = data.lastBounceAt ? data.lastBounceAt.toMillis() : null
    const withinWindow = lastMs !== null && now - lastMs <= SOFT_BOUNCE_WINDOW_MS

    const nextCount = withinWindow ? (data.count ?? 0) + 1 : 1

    const escalate = nextCount >= SOFT_BOUNCE_ESCALATION_THRESHOLD

    tx.update(ref, {
      count: nextCount,
      // Reset the window anchor when we restarted the counter.
      ...(withinWindow ? {} : { firstBounceAt: FieldValue.serverTimestamp() }),
      lastBounceAt: FieldValue.serverTimestamp(),
      lastEmailId: emailId,
      ...(escalate ? { escalatedAt: FieldValue.serverTimestamp() } : {}),
    })

    return { count: nextCount, escalate, duplicate: false }
  })
}

/**
 * Clear the soft-bounce counter for an address — call when an address is
 * removed from the suppression list (admin override) so a fresh series of soft
 * bounces starts from zero. Best-effort; missing docs are a no-op.
 */
export async function clearSoftBounceTracking(orgId: string, email: string): Promise<void> {
  const e = normalizeEmail(email)
  if (!orgId || !e) return
  await adminDb.collection(COLLECTION).doc(bounceTrackingDocId(orgId, e)).delete().catch(() => {})
}
