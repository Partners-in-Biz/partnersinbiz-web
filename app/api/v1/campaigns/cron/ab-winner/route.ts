// app/api/v1/campaigns/cron/ab-winner/route.ts
//
// GET — campaign A/B winner finalizer + fan-out.
//
// Secured by Authorization: Bearer ${CRON_SECRET} (same scheme as
// /app/api/cron/broadcasts/route.ts).
//
// Per tick:
//   1. FINALIZE: campaigns with ab.enabled, ab.status === 'testing',
//      ab.autoPromote, and testEndsAt elapsed → pick a winner via statistical
//      significance (fall back to highest-rate after a hard cap), set
//      ab.winnerVariantId + ab.status = 'winner-pending'.
//   2. DISPATCH: campaigns with ab.status === 'winner-pending' → send the
//      winning variant to the REMAINING audience (the contacts deferred during
//      the test cohort), then set ab.status = 'winner-sent'.
//
// The winner-only A/B model for campaigns: during the test window only
// `testCohortPercent`% of the audience receives variants (the campaign's
// normal enrollment send picks variants via assignForWinnerOnly). Once a
// winner is known, this cron sends the winning variant directly to the
// remaining (100 - cohort)% via sendCampaignEmail and records an `emails` doc
// (campaignId + variantId) so analytics + the webhook roll-ups attribute it.
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { Campaign } from '@/lib/campaigns/types'
import type { Contact } from '@/lib/crm/types'
import type { Sequence } from '@/lib/sequences/types'
import type { AbConfig, Variant } from '@/lib/ab-testing/types'
import { selectWinner, selectWinnerWithSignificance } from '@/lib/ab-testing/winner'
import { applyVariantOverrides } from '@/lib/ab-testing/apply'
import { assignForWinnerOnly } from '@/lib/ab-testing/assign'
import { resolveSegmentContacts } from '@/lib/crm/segments'
import { resolveFrom } from '@/lib/email/resolveFrom'
import { sendCampaignEmail, htmlToPlainText, plainTextToHtml } from '@/lib/email/resend'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Hard cap so a stalled test eventually produces a winner (mirrors cronHelpers).
const MAX_TEST_DURATION_MS = 7 * 24 * 60 * 60 * 1000
const EXTEND_TEST_WINDOW_MS = 6 * 60 * 60 * 1000
const CONTACT_CHUNK = 50

function tsMs(ts: Timestamp | null | undefined): number | null {
  if (!ts) return null
  try {
    return ts.toMillis()
  } catch {
    return null
  }
}

/** Resolve a campaign's full audience → contactId list (segment OR explicit). */
async function resolveAudience(campaign: Campaign): Promise<string[]> {
  if (campaign.segmentId) {
    const segSnap = await adminDb.collection('segments').doc(campaign.segmentId).get()
    if (!segSnap.exists || segSnap.data()?.deleted || segSnap.data()?.orgId !== campaign.orgId) return []
    const filters = segSnap.data()?.filters ?? {}
    const contacts = await resolveSegmentContacts(campaign.orgId, filters)
    return contacts.map((c: Contact) => c.id)
  }
  if (Array.isArray(campaign.contactIds) && campaign.contactIds.length > 0) {
    return [...campaign.contactIds]
  }
  return []
}

/** Base content for override application — the campaign's first sequence step. */
async function loadBaseContent(
  campaign: Campaign,
): Promise<{ subject: string; bodyHtml: string; bodyText: string } | null> {
  if (!campaign.sequenceId) return null
  const seqSnap = await adminDb.collection('sequences').doc(campaign.sequenceId).get()
  if (!seqSnap.exists || seqSnap.data()?.deleted) return null
  const sequence = { id: seqSnap.id, ...seqSnap.data() } as Sequence
  const step = sequence.steps?.[0]
  if (!step) return null
  return {
    subject: step.subject ?? '',
    bodyHtml: step.bodyHtml ?? '',
    bodyText: step.bodyText ?? '',
  }
}

async function finalizeWinner(id: string, campaign: Campaign, ab: AbConfig): Promise<boolean> {
  const result = selectWinnerWithSignificance(ab.variants, ab.winnerMetric)
  const now = FieldValue.serverTimestamp()

  if (result.reason !== 'significant' || !result.winner) {
    // Not significant yet — extend the window up to the hard cap, else fall
    // back to the highest-rate variant so the test eventually resolves.
    const startedMs = tsMs(ab.testStartedAt) ?? Date.now()
    const cap = startedMs + MAX_TEST_DURATION_MS
    const proposed = Date.now() + EXTEND_TEST_WINDOW_MS
    if (proposed <= cap) {
      await adminDb.collection('campaigns').doc(id).update({
        'ab.testEndsAt': Timestamp.fromMillis(proposed),
        updatedAt: now,
      })
      return false
    }
    const fallback = selectWinner(ab.variants, ab.winnerMetric)
    if (!fallback) return false
    await adminDb.collection('campaigns').doc(id).update({
      'ab.winnerVariantId': fallback.id,
      'ab.winnerDecidedAt': now,
      'ab.status': 'winner-pending',
      updatedAt: now,
    })
    return true
  }

  await adminDb.collection('campaigns').doc(id).update({
    'ab.winnerVariantId': result.winner.id,
    'ab.winnerDecidedAt': now,
    'ab.status': 'winner-pending',
    updatedAt: now,
  })
  return true
}

async function dispatchWinner(
  id: string,
  campaign: Campaign,
  ab: AbConfig,
): Promise<{ sent: number; skipped: number }> {
  const winner: Variant | undefined = ab.variants.find((v) => v.id === ab.winnerVariantId)
  if (!winner) return { sent: 0, skipped: 0 }

  const base = await loadBaseContent(campaign)
  if (!base) {
    console.warn('[campaigns/ab-winner] campaign', id, 'has no base content — skipping dispatch')
    return { sent: 0, skipped: 0 }
  }

  const audience = await resolveAudience(campaign)
  if (audience.length === 0) {
    console.warn('[campaigns/ab-winner] campaign', id, 'has empty audience — skipping')
    return { sent: 0, skipped: 0 }
  }

  const sender = await resolveFrom({
    fromDomainId: campaign.fromDomainId,
    fromName: campaign.fromName,
    fromLocal: campaign.fromLocal,
  })

  const effective = applyVariantOverrides(
    {
      subject: base.subject,
      bodyHtml: base.bodyHtml || plainTextToHtml(base.bodyText),
      bodyText: base.bodyText || htmlToPlainText(base.bodyHtml),
      fromName: campaign.fromName,
      scheduledFor: null,
    },
    winner,
  )
  const fromAddress = effective.fromName && effective.fromName !== campaign.fromName
    ? (await resolveFrom({
        fromDomainId: campaign.fromDomainId,
        fromName: effective.fromName,
        fromLocal: campaign.fromLocal,
      })).from
    : sender.from

  let sent = 0
  let skipped = 0
  const subjectId = id

  for (let i = 0; i < audience.length; i += CONTACT_CHUNK) {
    const chunk = audience.slice(i, i + CONTACT_CHUNK)
    for (const contactId of chunk) {
      // Only contacts DEFERRED during the test (outside the test cohort) get
      // the winner now — cohort members already received a variant.
      const pick = assignForWinnerOnly(contactId, subjectId, {
        ...ab,
        winnerVariantId: '', // force cohort gating, not "everyone gets winner"
      })
      if (!pick.defer) {
        skipped++
        continue
      }

      const cSnap = await adminDb.collection('contacts').doc(contactId).get()
      if (!cSnap.exists) {
        skipped++
        continue
      }
      const contact = cSnap.data() as Contact
      if (contact.deleted || contact.orgId !== campaign.orgId) {
        skipped++
        continue
      }
      if (contact.unsubscribedAt || contact.bouncedAt) {
        skipped++
        continue
      }

      // Idempotency: deterministic emails doc id (campaign + contact + winner).
      const emailDocId = `campaign_${id}_${contactId}_${winner.id}`
      const emailRef = adminDb.collection('emails').doc(emailDocId)
      const existing = await emailRef.get()
      if (existing.exists) {
        skipped++
        continue
      }

      const to = (contact.email ?? '').trim()
      if (!to) {
        skipped++
        continue
      }

      const result = await sendCampaignEmail({
        from: fromAddress,
        to,
        replyTo: campaign.replyTo || undefined,
        subject: effective.subject,
        html: effective.bodyHtml,
        text: effective.bodyText,
      })

      await emailRef.set({
        orgId: campaign.orgId,
        campaignId: id,
        broadcastId: '',
        fromDomainId: sender.fromDomainId,
        direction: 'outbound',
        contactId,
        resendId: result.resendId ?? '',
        provider: result.provider ?? '',
        providerMessageId: result.resendId ?? '',
        from: fromAddress,
        to,
        cc: [],
        subject: effective.subject,
        bodyHtml: effective.bodyHtml,
        bodyText: effective.bodyText,
        status: result.ok ? 'sent' : 'failed',
        scheduledFor: null,
        sentAt: result.ok ? FieldValue.serverTimestamp() : null,
        openedAt: null,
        clickedAt: null,
        bouncedAt: null,
        sequenceId: campaign.sequenceId,
        sequenceStep: 0,
        variantId: winner.id,
        createdAt: FieldValue.serverTimestamp(),
        deleted: false,
      })

      if (result.ok) {
        sent++
        // Roll the send into both the campaign aggregate stats and the
        // per-variant counter (the webhook bumps opens/clicks/bounces later).
        await adminDb.collection('campaigns').doc(id).update({
          'stats.sent': FieldValue.increment(1),
          'stats.delivered': FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        })
        const idx = ab.variants.findIndex((v) => v.id === winner.id)
        if (idx >= 0) {
          await adminDb.collection('campaigns').doc(id).update({
            [`ab.variants.${idx}.sent`]: FieldValue.increment(1),
            [`ab.variants.${idx}.delivered`]: FieldValue.increment(1),
          })
        }
      } else {
        skipped++
      }
    }
  }

  await adminDb.collection('campaigns').doc(id).update({
    'ab.status': 'winner-sent',
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { sent, skipped }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization') ?? ''
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = Timestamp.now()

  // 1) Finalize testing campaigns whose window elapsed (autoPromote on).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const testingSnap = await (adminDb.collection('campaigns') as any)
    .where('ab.status', '==', 'testing')
    .get()

  let finalized = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const doc of testingSnap.docs) {
    const campaign = { id: doc.id, ...doc.data() } as Campaign
    const ab = (doc.data().ab as AbConfig | undefined) ?? null
    if (!ab || !ab.enabled || !ab.autoPromote) continue
    if (!ab.testEndsAt || ab.testEndsAt.toMillis() > now.toMillis()) continue
    try {
      const changed = await finalizeWinner(doc.id, campaign, ab)
      if (changed) finalized++
    } catch (err) {
      console.error('[campaigns/ab-winner] finalize failed', doc.id, err)
    }
  }

  // 2) Dispatch winners for campaigns in winner-pending.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingSnap = await (adminDb.collection('campaigns') as any)
    .where('ab.status', '==', 'winner-pending')
    .get()

  let dispatched = 0
  let totalSent = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const doc of pendingSnap.docs) {
    const campaign = { id: doc.id, ...doc.data() } as Campaign
    const ab = (doc.data().ab as AbConfig | undefined) ?? null
    if (!ab || !ab.enabled || !ab.winnerVariantId) continue
    try {
      const res = await dispatchWinner(doc.id, campaign, ab)
      totalSent += res.sent
      dispatched++
    } catch (err) {
      console.error('[campaigns/ab-winner] dispatch failed', doc.id, err)
    }
  }

  return NextResponse.json({
    ok: true,
    finalized,
    dispatched,
    sent: totalSent,
    checkedTesting: testingSnap.size,
    checkedPending: pendingSnap.size,
  })
}
