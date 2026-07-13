/**
 * GET /api/cron/broadcasts — process scheduled broadcasts due now.
 *
 * Secured by Authorization: Bearer ${CRON_SECRET}
 * Vercel cron schedule: every 15 minutes (see vercel.json).
 *
 * Flow per tick:
 *   1. Find broadcasts where status == 'scheduled' AND scheduledFor <= now,
 *      plus any stuck in 'sending' (resume mid-flight).
 *   2. For each: flip to 'sending', resolve audience, set audienceSize +
 *      sendStartedAt the first time around.
 *   3. Walk the audience in chunks of CONTACT_CHUNK, calling
 *      sendBroadcastToContact() — which is idempotent via
 *      (broadcastId, contactId) uniqueness in the emails collection.
 *   4. When all contacts done, flip to 'sent' and set sendCompletedAt.
 *   5. On a per-broadcast crash, we leave status='sending' so the next tick
 *      picks up where this one stopped. The idempotency check skips already
 *      sent contacts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { resolveBroadcastAudience } from '@/lib/broadcasts/audience'
import {
  buildSendContext,
  loadSentContactIds,
  sendBroadcastToContact,
  sendBroadcastToContactWithVariant,
} from '@/lib/broadcasts/send'
import type { Broadcast } from '@/lib/broadcasts/types'
import {
  maybeFinalizeWinner,
  dispatchWinnerToRemaining,
} from '@/lib/ab-testing/cronHelpers'
import type { AbConfig, Variant } from '@/lib/ab-testing/types'
import type { Contact } from '@/lib/crm/types'
import { isLocalDeliveryWindowOpen } from '@/lib/email/send-time'
import { assertEmailMarketingDispatchApproval } from '@/lib/email-marketing/agent-governance'

export const dynamic = 'force-dynamic'
// Cron tasks can take longer than the default — give them up to 5 min.
export const maxDuration = 300

const CONTACT_CHUNK = 50

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization') ?? ''
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = Timestamp.now()

  // Pick up freshly-due 'scheduled' rows AND anything stuck in 'sending'
  // from a prior tick that didn't finish.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dueSnap = await (adminDb.collection('broadcasts') as any)
    .where('status', '==', 'scheduled')
    .where('scheduledFor', '<=', now)
    .get()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sendingSnap = await (adminDb.collection('broadcasts') as any)
    .where('status', '==', 'sending')
    .get()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docs: any[] = [...dueSnap.docs, ...sendingSnap.docs]

  let processedBroadcasts = 0
  let sentTotal = 0
  let failedTotal = 0
  let skippedTotal = 0
  let abFinalized = 0
  let abDispatched = 0

  // A/B housekeeping: finalize winners for broadcasts whose test window has
  // elapsed, and dispatch the winner to the remaining audience for any
  // already in `winner-pending`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const abTestingSnap = await (adminDb.collection('broadcasts') as any)
    .where('ab.status', '==', 'testing')
    .get()
  for (const d of abTestingSnap.docs) {
    const ab = d.data()?.ab as AbConfig | undefined
    if (!ab) continue
    try {
      await assertEmailMarketingDispatchApproval({ id: d.id, ...d.data() }, {
        orgId: String(d.data()?.orgId ?? ''), resourceType: 'email_broadcast', resourceId: d.id,
      })
    } catch {
      continue
    }
    const newStatus = await maybeFinalizeWinner({
      targetCollection: 'broadcasts',
      targetId: d.id,
      ab,
    })
    if (newStatus === 'winner-pending') abFinalized++
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const abPendingSnap = await (adminDb.collection('broadcasts') as any)
    .where('ab.status', '==', 'winner-pending')
    .get()
  for (const d of abPendingSnap.docs) {
    const ab = d.data()?.ab as AbConfig | undefined
    if (!ab) continue
    try {
      await assertEmailMarketingDispatchApproval({ id: d.id, ...d.data() }, {
        orgId: String(d.data()?.orgId ?? ''), resourceType: 'email_broadcast', resourceId: d.id,
      })
    } catch {
      continue
    }
    const result = await dispatchWinnerToRemaining({ broadcastId: d.id, ab })
    abDispatched += result.queued
  }

  for (const docSnap of docs) {
    const broadcast = { id: docSnap.id, ...docSnap.data() } as Broadcast
    if (broadcast.deleted) continue

    try {
      await assertEmailMarketingDispatchApproval(broadcast as unknown as Record<string, unknown>, {
        orgId: broadcast.orgId, resourceType: 'email_broadcast', resourceId: broadcast.id,
      })
      // Resolve audience first — needed both for the 'scheduled' → 'sending'
      // transition and for resuming 'sending' broadcasts.
      const contacts = await resolveBroadcastAudience(broadcast.orgId, broadcast.audience)

      // First-time transition.
      const isFirstTick = broadcast.status === 'scheduled'
      if (isFirstTick) {
        await docSnap.ref.update({
          status: 'sending',
          'stats.audienceSize': contacts.length,
          sendStartedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        broadcast.status = 'sending'
        broadcast.stats = { ...broadcast.stats, audienceSize: contacts.length }
      }

      if (contacts.length === 0) {
        await docSnap.ref.update({
          status: 'sent',
          sendCompletedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        processedBroadcasts++
        continue
      }

      const sentCache = await loadSentContactIds(
        broadcast.id,
        broadcast.channel === 'sms' ? 'sms' : 'email',
      )
      const ctx = await buildSendContext(broadcast)

      // Send-time optimisation gate. When `audienceLocalDelivery` is on we
      // only send to contacts whose local-wall clock has reached the
      // broadcast's target hour (or whose local window has expired). Any
      // contact deferred this tick will be retried on the next one — we
      // leave the broadcast in 'sending' so it keeps getting picked up.
      const localDelivery = broadcast.audienceLocalDelivery === true
      const localWindowHours =
        typeof broadcast.localDeliveryWindowHours === 'number' && broadcast.localDeliveryWindowHours > 0
          ? broadcast.localDeliveryWindowHours
          : 24
      let orgTimezone = ''
      if (localDelivery) {
        const orgSnap = await adminDb.collection('organizations').doc(broadcast.orgId).get()
        if (orgSnap.exists) {
          orgTimezone =
            ((orgSnap.data() as { settings?: { timezone?: string } } | undefined)?.settings?.timezone ?? '') || ''
        }
      }
      const nowUtc = new Date()
      const scheduledForUtc = broadcast.scheduledFor?.toDate?.() ?? nowUtc

      let deferredCount = 0
      // Chunked iteration — each chunk runs sequentially within the chunk
      // (so we don't slam Resend's rate limit) but moves on quickly.
      for (let i = 0; i < contacts.length; i += CONTACT_CHUNK) {
        const slice = contacts.slice(i, i + CONTACT_CHUNK)
        for (const contact of slice) {
          try {
            // Per-contact local-delivery check. Only contacts not already
            // sent and not yet in their local window are deferred.
            if (localDelivery && !sentCache.has(contact.id)) {
              const open = isLocalDeliveryWindowOpen({
                nowUtc,
                scheduledForUtc,
                orgTimezone,
                contactTimezone:
                  typeof (contact as Contact & { timezone?: string }).timezone === 'string' &&
                  (contact as Contact & { timezone?: string }).timezone!.trim()
                    ? (contact as Contact & { timezone?: string }).timezone!.trim()
                    : undefined,
                windowHours: localWindowHours,
              })
              if (!open) {
                deferredCount++
                continue
              }
            }
            const outcome = await sendBroadcastToContact(ctx, contact, sentCache)
            if (outcome.status === 'sent') sentTotal++
            else if (outcome.status === 'failed') failedTotal++
            else if (outcome.status === 'skipped') skippedTotal++
          } catch (err) {
            failedTotal++
            // eslint-disable-next-line no-console
            console.error('[cron/broadcasts] contact failed', broadcast.id, contact.id, err)
          }
        }
      }

      if (deferredCount > 0) {
        // Leave broadcast in `sending` — next cron tick picks it back up and
        // re-evaluates the window for each remaining recipient.
        await docSnap.ref.update({
          updatedAt: FieldValue.serverTimestamp(),
        })
        processedBroadcasts++
      } else {
        // All contacts have either been queued or skipped; mark complete.
        await docSnap.ref.update({
          status: 'sent',
          sendCompletedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        processedBroadcasts++
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[cron/broadcasts] broadcast failed', docSnap.id, err)
      // Leave status='sending' so the next tick can resume.
    }
  }

  // -----------------------------------------------------------------------
  // broadcast_recipients DRAIN — A/B winner-only mode.
  //
  // `dispatchWinnerToRemaining` wrote pending rows here for every contact
  // that was deferred during the test cohort. The regular audience loop
  // above does NOT read this collection, so without this drain the winner
  // never actually reaches the deferred contacts. Each row gets a single
  // dispatch and is then marked 'sent' or 'failed'.
  //
  // Idempotency: rows already in status 'sent' or 'failed' are skipped.
  // Inside `sendBroadcastToContact`, the (broadcastId, contactId) email-doc
  // idempotency check provides a second safety net — re-running the drain
  // on already-sent recipients does NOT cause a second send.
  // -----------------------------------------------------------------------
  let recipientsDrained = 0
  let recipientsFailed = 0
  let recipientsSkipped = 0

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pendingSnap = await (adminDb.collection('broadcast_recipients') as any)
      .where('status', '==', 'pending')
      .limit(200)
      .get()

    // Group pending recipients by broadcastId so we build the send context
    // once per broadcast.
    const groups = new Map<
      string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Array<{ docRef: any; contactId: string; variantId: string }>
    >()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const d of pendingSnap.docs as any[]) {
      const data = d.data() ?? {}
      const broadcastId = typeof data.broadcastId === 'string' ? data.broadcastId : ''
      const contactId = typeof data.contactId === 'string' ? data.contactId : ''
      const variantId = typeof data.variantId === 'string' ? data.variantId : ''
      if (!broadcastId || !contactId) continue
      const list = groups.get(broadcastId) ?? []
      list.push({ docRef: d.ref, contactId, variantId })
      groups.set(broadcastId, list)
    }

    for (const [broadcastId, items] of groups.entries()) {
      try {
        const bSnap = await adminDb.collection('broadcasts').doc(broadcastId).get()
        if (!bSnap.exists) {
          for (const it of items) {
            await it.docRef.update({
              status: 'failed',
              error: 'broadcast not found',
              failedAt: FieldValue.serverTimestamp(),
            })
            recipientsFailed++
          }
          continue
        }
        const broadcast = { id: bSnap.id, ...bSnap.data() } as Broadcast
        if (broadcast.deleted) {
          for (const it of items) {
            await it.docRef.update({
              status: 'failed',
              error: 'broadcast deleted',
              failedAt: FieldValue.serverTimestamp(),
            })
            recipientsFailed++
          }
          continue
        }

        await assertEmailMarketingDispatchApproval(broadcast as unknown as Record<string, unknown>, {
          orgId: broadcast.orgId, resourceType: 'email_broadcast', resourceId: broadcast.id,
        })

        const ab = broadcast.ab
        const variants: Variant[] = (ab?.variants ?? []) as Variant[]
        const ctx = await buildSendContext(broadcast)

        for (const it of items) {
          try {
            // Re-check current state — another tick might have processed it.
            const recipFresh = await it.docRef.get()
            if (!recipFresh.exists) {
              recipientsSkipped++
              continue
            }
            const rData = recipFresh.data() ?? {}
            if (rData.status !== 'pending') {
              recipientsSkipped++
              continue
            }

            const variant = variants.find((v) => v.id === it.variantId) ?? null
            if (!variant) {
              await it.docRef.update({
                status: 'failed',
                error: `variant ${it.variantId} not found on broadcast`,
                failedAt: FieldValue.serverTimestamp(),
              })
              recipientsFailed++
              continue
            }

            const contactSnap = await adminDb.collection('contacts').doc(it.contactId).get()
            if (!contactSnap.exists) {
              await it.docRef.update({
                status: 'failed',
                error: 'contact not found',
                failedAt: FieldValue.serverTimestamp(),
              })
              recipientsFailed++
              continue
            }
            const contact = { id: contactSnap.id, ...contactSnap.data() } as Contact

            const outcome = await sendBroadcastToContactWithVariant(ctx, contact, variant, null)

            if (outcome.status === 'sent') {
              await it.docRef.update({
                status: 'sent',
                sentAt: FieldValue.serverTimestamp(),
                resendId: outcome.resendId ?? '',
              })
              recipientsDrained++
            } else if (outcome.status === 'failed') {
              await it.docRef.update({
                status: 'failed',
                error: outcome.error ?? 'send failed',
                failedAt: FieldValue.serverTimestamp(),
              })
              recipientsFailed++
            } else {
              // skipped — disambiguate idempotency vs preferences/cap.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const dupSnap = await (adminDb.collection('emails') as any)
                .where('broadcastId', '==', broadcast.id)
                .where('contactId', '==', it.contactId)
                .limit(1)
                .get()
              if (!dupSnap.empty) {
                await it.docRef.update({
                  status: 'sent',
                  sentAt: FieldValue.serverTimestamp(),
                })
                recipientsDrained++
              } else {
                await it.docRef.update({
                  status: 'failed',
                  error: 'skipped by preferences/cap',
                  failedAt: FieldValue.serverTimestamp(),
                })
                recipientsSkipped++
              }
            }
          } catch (err) {
            try {
              await it.docRef.update({
                status: 'failed',
                error: (err as Error)?.message ?? String(err),
                failedAt: FieldValue.serverTimestamp(),
              })
            } catch {
              // best effort
            }
            recipientsFailed++
            // eslint-disable-next-line no-console
            console.error('[cron/broadcasts] drain recipient failed', broadcastId, it.contactId, err)
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[cron/broadcasts] drain broadcast group failed', broadcastId, err)
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[cron/broadcasts] drain query failed', err)
  }

  return NextResponse.json({
    success: true,
    data: {
      processedBroadcasts,
      sent: sentTotal,
      failed: failedTotal,
      skipped: skippedTotal,
      abFinalized,
      abDispatched,
      recipientsDrained,
      recipientsFailed,
      recipientsSkipped,
    },
  })
}
