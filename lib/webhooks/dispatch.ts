import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { WebhookEvent } from './types'

/**
 * Enqueue a webhook event for every active, subscribed webhook on an org.
 *
 * Looks up `outbound_webhooks` where `orgId == orgId`, `active == true`,
 * `deleted == false`, then filters in-memory by `events.includes(event)` and
 * writes one `webhook_queue` doc per match. The cron worker
 * (`lib/webhooks/worker.ts`) picks these up on the next tick.
 *
 * **IMPORTANT — callers MUST wrap this in `try/catch`.** This function may
 * reject if Firestore is unreachable or the write batch fails. It must never
 * be allowed to throw up into an API response path — a failed webhook enqueue
 * must not block the originating operation (invoice.paid must still return 200
 * even if the webhook queue is temporarily unavailable). Log the error and
 * move on:
 *
 * ```ts
 * try {
 *   await dispatchWebhook(orgId, 'invoice.paid', payload)
 * } catch (err) {
 *   console.error('[webhook-dispatch-error]', err)
 * }
 * ```
 *
 * @returns `{ queued }` — number of queue items written (0 when no subscribers).
 */
export async function dispatchWebhook(
  orgId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<{ queued: number }> {
  const snap = await adminDb
    .collection('outbound_webhooks')
    .where('orgId', '==', orgId)
    .where('active', '==', true)
    .where('deleted', '==', false)
    .get()

  const matching = snap.docs.filter((d) => {
    const events = (d.data().events ?? []) as WebhookEvent[]
    return Array.isArray(events) && events.includes(event)
  })

  // Best-effort PiB routine event fan-out (independent of outbound subscribers).
  try {
    const { fanoutRoutineEvent } = await import('@/lib/routines/event-fanout')
    void fanoutRoutineEvent(orgId, {
      eventId: `${event}_${Date.now()}`,
      source: 'pib',
      summary: event,
      filter: { event },
      data: payload,
    }).catch((err) => console.error('[routines-fanout]', err))
  } catch (err) {
    console.error('[routines-fanout]', err)
  }

  if (!matching.length) return { queued: 0 }

  const batch = adminDb.batch()
  const now = new Date()

  for (const doc of matching) {
    const qRef = adminDb.collection('webhook_queue').doc()
    batch.set(qRef, {
      webhookId: doc.id,
      orgId,
      event,
      payload,
      status: 'pending',
      retryCount: 0,
      nextAttemptAt: now,
      createdAt: FieldValue.serverTimestamp(),
      claimedAt: null,
    })
  }

  await batch.commit()
  return { queued: matching.length }
}
