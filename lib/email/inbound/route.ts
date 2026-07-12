// lib/email/inbound/route.ts
//
// Routing pipeline for an inbound email. Given a freshly-classified
// `InboundEmail`, this:
//
//   1. Resolves the matching outbound email by Message-ID / References,
//      falling back to contact lookup by `fromEmail`.
//   2. Carries orgId / contactId / sequenceId / campaignId / broadcastId
//      from the matched outbound onto the inbound doc.
//   3. Applies side-effects per intent:
//        reply              → pause active enrollments, bump
//                             contact.repliesCount + lastRepliedAt, log
//                             activity, notify admins.
//        auto-reply         → log activity only (no pause).
//        bounce-reply       → add a soft-bounce suppression for this
//                             (org, email) and log activity.
//        unsubscribe-reply  → mark contact.unsubscribedAt = now, pause
//                             enrollments with exitReason='unsubscribed',
//                             log activity, notify admins.
//   4. Marks the inbound doc processed.
//   5. Best-effort: emails the org's reply-notify list.
//
// All Firestore writes are best-effort within the function — a failure on
// (e.g.) notification email won't roll back the pause. We still return
// what happened so the webhook can surface results.

import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { getResendClient } from '@/lib/email/resend'
import { addSuppression, temporaryExpiryFromNow } from '@/lib/email/suppressions'
import { resolveFrom } from '@/lib/email/resolveFrom'
import { routeReplyToSales, type ReplyOutboundSnapshot } from '@/lib/email-marketing/reply-routing'
import { classifySalesReply } from '@/lib/email-marketing/reply-classification'
import type { InboundEmail, ReplyIntent } from './types'

export interface ProcessInboundResult {
  intent: ReplyIntent
  pausedEnrollments: number
  unsubscribed: boolean
  contactMatched: boolean
  outboundMatched: boolean
  replyOwnerUserId: string | null
  replyQueueId: string | null
}

/**
 * Resend Message-IDs in outbound mail are typically of the form
 *   <resendId@regionalmailserver.amazonses.com>
 * or just the bare resendId. Inbound replies' In-Reply-To / References
 * carry the wrapped form. We strip `<` `>` and everything after the
 * first `@` to recover the candidate resendId.
 */
export function extractResendIdCandidate(messageId: string): string {
  if (!messageId) return ''
  const trimmed = messageId.trim().replace(/^<+|>+$/g, '')
  const at = trimmed.indexOf('@')
  return at > 0 ? trimmed.slice(0, at) : trimmed
}

/**
 * Try to find the outbound `emails` doc this inbound is replying to.
 * Walks `inReplyTo` first, then each `references` entry, by resendId.
 * Returns the matched doc data or null.
 */
async function findOutboundByMessageId(
  inReplyTo: string,
  references: string[],
): Promise<{
  emailId: string
  data: Record<string, unknown>
} | null> {
  const candidates: string[] = []
  if (inReplyTo) candidates.push(extractResendIdCandidate(inReplyTo))
  for (const ref of references ?? []) {
    const c = extractResendIdCandidate(ref)
    if (c && !candidates.includes(c)) candidates.push(c)
  }
  for (const candidate of candidates) {
    if (!candidate) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snap = await (adminDb.collection('emails') as any)
      .where('resendId', '==', candidate)
      .limit(1)
      .get()
    if (!snap.empty) {
      const doc = snap.docs[0]
      return { emailId: doc.id, data: doc.data() ?? {} }
    }
  }
  return null
}

/**
 * Fallback contact lookup. Used when the inbound message had no Message-ID
 * we could match. Searches all orgs for a contact whose email matches the
 * sender. Returns the first non-deleted match if any.
 */
async function findContactByEmail(
  fromEmail: string,
  orgId: string,
): Promise<{ contactId: string; orgId: string } | null> {
  const norm = (fromEmail ?? '').trim().toLowerCase()
  if (!norm || !orgId) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = await (adminDb.collection('contacts') as any)
    .where('orgId', '==', orgId)
    .where('email', '==', norm)
    .limit(5)
    .get()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const d of snap.docs as any[]) {
    const data = d.data() ?? {}
    if (data.deleted) continue
    if (!data.orgId) continue
    return { contactId: d.id, orgId: data.orgId }
  }
  return null
}

/**
 * Pause every active sequence enrollment for this (org, contact). Returns
 * the number of enrollments paused.
 */
async function pauseActiveEnrollments(
  orgId: string,
  contactId: string,
  exitReason: 'replied' | 'unsubscribed',
): Promise<number> {
  if (!orgId || !contactId) return 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = await (adminDb.collection('sequence_enrollments') as any)
    .where('orgId', '==', orgId)
    .where('contactId', '==', contactId)
    .where('status', '==', 'active')
    .get()
  let paused = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const d of snap.docs as any[]) {
    try {
      await d.ref.update({
        status: 'paused',
        exitReason,
        pausedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      paused++
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[inbound/route] failed to pause enrollment', d.id, err)
    }
  }
  return paused
}

/**
 * Send a notification email to the org's reply-notify list. Best-effort:
 * any failure is swallowed so the rest of the pipeline still completes.
 *
 * Reads `org.settings.replyNotifyEmails` (string[]); falls back to
 * `org.settings.notificationEmail` if that's empty.
 */
async function notifyAdmins(args: {
  orgId: string
  intent: ReplyIntent
  fromEmail: string
  fromName: string
  subject: string
  bodyText: string
  contactId: string
}): Promise<void> {
  if (!args.orgId) return
  try {
    const orgSnap = await adminDb.collection('organizations').doc(args.orgId).get()
    if (!orgSnap.exists) return
    const org = (orgSnap.data() ?? {}) as {
      name?: string
      settings?: { replyNotifyEmails?: string[]; notificationEmail?: string }
    }
    const list = Array.from(
      new Set(
        (org.settings?.replyNotifyEmails ?? [])
          .concat(org.settings?.notificationEmail ? [org.settings.notificationEmail] : [])
          .map((e) => (e ?? '').trim().toLowerCase())
          .filter((e) => e && e.includes('@')),
      ),
    )
    if (list.length === 0) return

    const orgName = org.name ?? ''
    const intentLabel: Record<ReplyIntent, string> = {
      reply: 'Reply received',
      'auto-reply': 'Auto-reply received',
      'bounce-reply': 'Bounce reply received',
      'unsubscribe-reply': 'Unsubscribe request received',
      unknown: 'Inbound email received',
    }
    const subject = `[${orgName || 'PiB'}] ${intentLabel[args.intent]}: ${args.subject || '(no subject)'}`
    const snippet = (args.bodyText ?? '').slice(0, 600)
    const html = `
      <p><strong>${intentLabel[args.intent]}</strong> from
        ${args.fromName ? `${args.fromName} &lt;${args.fromEmail}&gt;` : args.fromEmail}</p>
      <p><strong>Subject:</strong> ${args.subject || '(no subject)'}</p>
      <pre style="white-space:pre-wrap;font:13px/1.4 monospace;background:#f5f5f5;padding:12px;border-radius:6px">${snippet.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))}</pre>
      ${args.contactId ? `<p><a href="${process.env.NEXT_PUBLIC_BASE_URL ?? 'https://partnersinbiz.online'}/admin/crm/contacts/${args.contactId}">View contact</a></p>` : ''}
    `

    const resolved = await resolveFrom({
      fromDomainId: '',
      fromName: 'Partners in Biz',
      fromLocal: 'notifications',
      orgName,
    })

    if (!process.env.RESEND_API_KEY?.trim()) {
      // eslint-disable-next-line no-console
      console.warn('[inbound/route] RESEND_API_KEY not set — skipping reply notification email')
      return
    }

    const client = getResendClient()
    await client.emails.send({
      from: resolved.from,
      to: list,
      subject,
      html,
      text: `${intentLabel[args.intent]} from ${args.fromName ? `${args.fromName} <${args.fromEmail}>` : args.fromEmail}\nSubject: ${args.subject}\n\n${snippet}`,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[inbound/route] notifyAdmins failed', err)
  }
}

export async function processInboundEmail(
  inboundDocId: string,
  inbound: InboundEmail,
): Promise<ProcessInboundResult> {
  let { orgId, contactId, sequenceId, campaignId, broadcastId, replyToEmailId } = inbound
  let outboundSnapshot: ReplyOutboundSnapshot | null = null

  // 1. Match by Message-ID first. The outbound record is authoritative for
  // tenant lineage; inbound payload fields may never widen that scope.
  let outboundMatched = false
  const matched = await findOutboundByMessageId(inbound.inReplyTo, inbound.references)
  if (matched) {
    outboundMatched = true
    const d = matched.data as unknown as ReplyOutboundSnapshot
    if (orgId && d.orgId && orgId !== d.orgId) {
      throw new Error('Inbound/outbound organisation mismatch')
    }
    replyToEmailId = matched.emailId
    orgId = d.orgId || ''
    contactId = d.contactId || ''
    sequenceId = d.sequenceId || ''
    campaignId = d.campaignId || ''
    broadcastId = d.broadcastId || ''
    outboundSnapshot = {
      ...d,
      orgId,
      contactId,
      sequenceId,
      campaignId,
      broadcastId,
    }
  }

  // 2. A sender-email fallback is only safe once an organisation has already
  // been resolved. Never pick the first same-email contact across tenants.
  if (!contactId && orgId) {
    const fallback = await findContactByEmail(inbound.fromEmail, orgId)
    if (fallback) contactId = fallback.contactId
  }

  // Update the inbound doc with whatever we resolved.
  try {
    await adminDb.collection('inbound_emails').doc(inboundDocId).update({
      orgId,
      contactId,
      sequenceId,
      campaignId,
      broadcastId,
      replyToEmailId,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[inbound/route] failed to persist resolved fields', err)
  }

  let pausedEnrollments = 0
  let unsubscribed = false
  let replyOwnerUserId: string | null = null
  let replyQueueId: string | null = null

  // 3. Apply intent.
  switch (inbound.intent) {
    case 'reply': {
      if (outboundSnapshot) {
        const salesClassification = classifySalesReply({ subject: inbound.subject, bodyText: inbound.bodyText })
        const routed = await routeReplyToSales({
          inboundId: inboundDocId,
          inboundOrgId: inbound.orgId,
          outboundEmailId: replyToEmailId,
          outbound: outboundSnapshot,
          subject: inbound.subject,
          bodyText: inbound.bodyText,
          fromEmail: inbound.fromEmail,
          receivedAt: inbound.receivedAt,
        })
        replyOwnerUserId = routed.ownerUserId
        replyQueueId = routed.queueId
        await adminDb.collection('inbound_emails').doc(inboundDocId).set({ salesClassification }, { merge: true })
      }
      break
    }
    case 'auto-reply': {
      if (orgId) {
        try {
          await adminDb.collection('activities').add({
            orgId,
            contactId,
            dealId: '',
            type: 'email_auto_reply',
            summary: `Auto-reply: ${inbound.subject || '(no subject)'}`,
            metadata: { inboundEmailId: inboundDocId, replyToEmailId },
            createdBy: 'system',
            createdAt: FieldValue.serverTimestamp(),
          })
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[inbound/route] failed to log auto-reply activity', err)
        }
      }
      break
    }
    case 'bounce-reply': {
      if (orgId && inbound.fromEmail) {
        try {
          await addSuppression({
            orgId,
            email: inbound.fromEmail,
            reason: 'soft-bounce',
            source: 'webhook',
            scope: 'temporary',
            expiresAt: temporaryExpiryFromNow(24),
            details: { emailId: replyToEmailId || undefined },
            createdBy: 'system',
          })
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[inbound/route] failed to add soft-bounce suppression', err)
        }
      }
      if (contactId) {
        try {
          await adminDb.collection('contacts').doc(contactId).update({
            bouncedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          })
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[inbound/route] failed to mark contact bouncedAt', err)
        }
      }
      if (orgId) {
        try {
          await adminDb.collection('activities').add({
            orgId,
            contactId,
            dealId: '',
            type: 'email_bounce_reply',
            summary: `Bounce reply: ${inbound.subject || '(no subject)'}`,
            metadata: { inboundEmailId: inboundDocId, replyToEmailId },
            createdBy: 'system',
            createdAt: FieldValue.serverTimestamp(),
          })
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[inbound/route] failed to log bounce-reply activity', err)
        }
      }
      break
    }
    case 'unsubscribe-reply': {
      unsubscribed = true
      if (contactId) {
        try {
          await adminDb.collection('contacts').doc(contactId).update({
            unsubscribedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          })
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[inbound/route] failed to mark contact unsubscribed', err)
        }
      }
      if (orgId && inbound.fromEmail) {
        try {
          await addSuppression({
            orgId,
            email: inbound.fromEmail,
            reason: 'manual-unsub',
            source: 'webhook',
            scope: 'permanent',
            expiresAt: null,
            details: { emailId: replyToEmailId || undefined },
            createdBy: 'system',
          })
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[inbound/route] failed to add unsub suppression', err)
        }
      }
      if (contactId && orgId) {
        pausedEnrollments = await pauseActiveEnrollments(orgId, contactId, 'unsubscribed')
      }
      if (orgId) {
        try {
          await adminDb.collection('activities').add({
            orgId,
            contactId,
            dealId: '',
            type: 'email_unsubscribe_reply',
            summary: `Unsubscribe request: ${inbound.subject || '(no subject)'}`,
            metadata: { inboundEmailId: inboundDocId, replyToEmailId },
            createdBy: 'system',
            createdAt: FieldValue.serverTimestamp(),
          })
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[inbound/route] failed to log unsubscribe-reply activity', err)
        }
      }
      break
    }
    case 'unknown':
    default:
      // No side effects beyond logging via the activity below.
      if (orgId) {
        try {
          await adminDb.collection('activities').add({
            orgId,
            contactId,
            dealId: '',
            type: 'email_inbound_unknown',
            summary: `Inbound email: ${inbound.subject || '(no subject)'}`,
            metadata: { inboundEmailId: inboundDocId, replyToEmailId },
            createdBy: 'system',
            createdAt: FieldValue.serverTimestamp(),
          })
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[inbound/route] failed to log unknown-intent activity', err)
        }
      }
      break
  }

  // 4. Best-effort admin notification (skip for auto-reply by default —
  // they're noise; reply / bounce / unsub are all interesting).
  if (inbound.intent !== 'auto-reply' && orgId) {
    await notifyAdmins({
      orgId,
      intent: inbound.intent,
      fromEmail: inbound.fromEmail,
      fromName: inbound.fromName,
      subject: inbound.subject,
      bodyText: inbound.bodyText,
      contactId,
    })
  }

  // 5. Mark processed.
  try {
    await adminDb.collection('inbound_emails').doc(inboundDocId).update({
      processed: true,
      processedAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[inbound/route] failed to mark inbound processed', err)
  }

  return {
    intent: inbound.intent,
    pausedEnrollments,
    unsubscribed,
    contactMatched: !!contactId,
    outboundMatched,
    replyOwnerUserId,
    replyQueueId,
  }
}

/**
 * Convenience: build a fresh InboundEmail object from the parsed Resend
 * payload pieces. The webhook handler uses this then writes the doc and
 * passes the object into processInboundEmail().
 */
export function newInboundEmail(input: {
  fromEmail: string
  fromName: string
  toEmail: string
  subject: string
  bodyText: string
  bodyHtml: string
  rawHeaders: Record<string, string>
  inReplyTo: string
  references: string[]
  attachments: InboundEmail['attachments']
  intent: ReplyIntent
}): Omit<InboundEmail, 'id' | 'processedAt' | 'createdAt'> & { receivedAt: Timestamp } {
  return {
    orgId: '',
    fromEmail: (input.fromEmail ?? '').trim().toLowerCase(),
    fromName: input.fromName ?? '',
    toEmail: (input.toEmail ?? '').trim().toLowerCase(),
    replyToEmailId: '',
    contactId: '',
    campaignId: '',
    sequenceId: '',
    broadcastId: '',
    subject: input.subject ?? '',
    bodyText: input.bodyText ?? '',
    bodyHtml: input.bodyHtml ?? '',
    rawHeaders: input.rawHeaders ?? {},
    intent: input.intent,
    inReplyTo: input.inReplyTo ?? '',
    references: input.references ?? [],
    attachments: input.attachments ?? [],
    receivedAt: Timestamp.now(),
    processed: false,
    deleted: false,
  }
}
