// app/api/v1/email/rss-automations/run/route.ts
//
// Cron-style processor for RSS digest automations (US-145).
//
// Auth: same pattern as app/api/cron/* — `Authorization: Bearer ${CRON_SECRET}`.
//
// For each DUE, enabled automation:
//   1. Fetch + parse the feed.
//   2. Determine which items are NEW since lastPostGuid (dedupe).
//   3. Build the digest (subject/body templates + RSS merge tags).
//   4. Resolve recipients (segment / tag / explicit contacts).
//   5. Send via the Resend helper, skipping suppressed/unsubscribed contacts.
//   6. Record lastRunAt + lastPostGuid + lastSentCount.
//
// A single bad automation never aborts the whole run.
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { apiSuccess, apiError } from '@/lib/api/response'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { sendCampaignEmail } from '@/lib/email/resend'
import { resolveFrom } from '@/lib/email/resolveFrom'
import { interpolate, varsFromContact } from '@/lib/email/template'
import { signUnsubscribeToken } from '@/lib/email/unsubscribeToken'
import { isSuppressed } from '@/lib/email/suppressions'
import { resolveSegmentContacts } from '@/lib/crm/segments'
import { fetchFeed, buildDigestVars, wrapDigestHtml, stripHtml, type RssItem } from '@/lib/email/rss'
import type { RssAutomation, RssRecipient } from '@/lib/email/rss-automation'
import { isRssAutomationDue } from '@/lib/email/rss-automation'
import type { Contact } from '@/lib/crm/types'

export const dynamic = 'force-dynamic'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://partnersinbiz.online'

interface RunSummary {
  automationId: string
  name: string
  sent: number
  skipped: number
  newItems: number
  status: 'sent' | 'no-new-items' | 'no-recipients' | 'feed-error'
}

function tsToDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  const c = value as { toDate?: () => Date; _seconds?: number; seconds?: number }
  if (typeof c.toDate === 'function') {
    try {
      return c.toDate()
    } catch {
      return null
    }
  }
  const seconds = c._seconds ?? c.seconds
  if (typeof seconds === 'number') return new Date(seconds * 1000)
  return null
}

/** Items newer than the last digest, identified by guid. */
function newItemsSince(items: RssItem[], lastPostGuid: string): RssItem[] {
  if (!lastPostGuid) return items
  const idx = items.findIndex((i) => i.guid === lastPostGuid)
  if (idx === -1) return items // last item no longer in feed → treat all as new
  return items.slice(0, idx)
}

async function resolveRecipients(orgId: string, recipient: RssRecipient): Promise<Contact[]> {
  if (recipient.kind === 'segment') {
    const segSnap = await adminDb.collection('segments').doc(recipient.segmentId).get()
    if (!segSnap.exists || segSnap.data()?.deleted) return []
    const seg = segSnap.data() ?? {}
    if (seg.orgId !== orgId) return []
    return resolveSegmentContacts(orgId, (seg.filters ?? {}) as Parameters<typeof resolveSegmentContacts>[1])
  }
  if (recipient.kind === 'tag') {
    return resolveSegmentContacts(orgId, { tags: [recipient.tag] })
  }
  // explicit contacts
  const out: Contact[] = []
  for (const id of recipient.contactIds.slice(0, 200)) {
    const snap = await adminDb.collection('contacts').doc(id).get()
    if (snap.exists && snap.data()?.orgId === orgId && !snap.data()?.deleted) {
      out.push({ id: snap.id, ...snap.data() } as Contact)
    }
  }
  return out
}

async function processAutomation(
  doc: { id: string; data: () => Record<string, unknown> },
  now: Date,
): Promise<RunSummary | null> {
  const data = doc.data() as unknown as RssAutomation
  const summary: RunSummary = {
    automationId: doc.id,
    name: data.name ?? '',
    sent: 0,
    skipped: 0,
    newItems: 0,
    status: 'no-new-items',
  }

  if (!isRssAutomationDue({ enabled: data.enabled, schedule: data.schedule, lastRunAt: tsToDate(data.lastRunAt) }, now)) {
    return null
  }

  const feed = await fetchFeed(data.feedUrl)
  if (!feed) {
    summary.status = 'feed-error'
    // Still stamp lastRunAt so a permanently broken feed doesn't retry every tick.
    await adminDb
      .collection('rss_automations')
      .doc(doc.id)
      .update({ lastRunAt: Timestamp.fromDate(now), updatedAt: FieldValue.serverTimestamp() })
    return summary
  }

  const fresh = newItemsSince(feed.items, data.lastPostGuid ?? '')
  summary.newItems = fresh.length
  if (fresh.length === 0) {
    await adminDb
      .collection('rss_automations')
      .doc(doc.id)
      .update({ lastRunAt: Timestamp.fromDate(now), updatedAt: FieldValue.serverTimestamp() })
    return summary
  }

  // Build the digest body.
  const digestVars = buildDigestVars({
    items: fresh,
    feedTitle: feed.title || data.name,
    maxItems: data.maxItems ?? 5,
  })

  const recipients = await resolveRecipients(data.orgId, data.recipient)
  if (recipients.length === 0) {
    summary.status = 'no-recipients'
    await adminDb.collection('rss_automations').doc(doc.id).update({
      lastRunAt: Timestamp.fromDate(now),
      lastPostGuid: fresh[0].guid,
      lastSentCount: 0,
      updatedAt: FieldValue.serverTimestamp(),
    })
    return summary
  }

  const orgSnap = await adminDb.collection('organizations').doc(data.orgId).get()
  const orgName = (orgSnap.data()?.name as string | undefined) ?? ''
  const resolved = await resolveFrom({ fromLocal: 'updates', orgName })

  for (const contact of recipients) {
    if (!contact.email) {
      summary.skipped++
      continue
    }
    if (contact.unsubscribedAt || contact.bouncedAt) {
      summary.skipped++
      continue
    }
    if (await isSuppressed(data.orgId, contact.email)) {
      summary.skipped++
      continue
    }

    const unsubscribeUrl = `${BASE_URL}/api/unsubscribe?token=${signUnsubscribeToken(contact.id)}`
    const preferencesUrl = `${BASE_URL}/preferences/${encodeURIComponent(signUnsubscribeToken(contact.id))}`
    const vars = {
      ...varsFromContact(contact),
      ...digestVars,
      orgName,
      unsubscribeUrl,
      preferencesUrl,
    }

    const subject = interpolate(data.subject, vars) || `New from ${feed.title || data.name}`
    const innerHtml = interpolate(data.bodyHtml, vars)
    const html = wrapDigestHtml(innerHtml, { title: subject })
    const text = stripHtml(innerHtml)

    const result = await sendCampaignEmail({
      from: resolved.from,
      to: contact.email,
      subject,
      html,
      text,
      listUnsubscribeUrl: unsubscribeUrl,
    })

    if (result.ok) {
      summary.sent++
      await adminDb.collection('emails').add({
        orgId: data.orgId,
        campaignId: '',
        fromDomainId: resolved.fromDomainId,
        direction: 'outbound',
        contactId: contact.id,
        resendId: result.resendId,
        provider: result.provider ?? '',
        providerMessageId: result.resendId,
        from: resolved.from,
        to: contact.email,
        cc: [],
        subject,
        bodyHtml: html,
        bodyText: text,
        status: 'sent',
        scheduledFor: null,
        sentAt: FieldValue.serverTimestamp(),
        openedAt: null,
        clickedAt: null,
        bouncedAt: null,
        rssAutomationId: doc.id,
        topicId: 'newsletter',
        createdAt: FieldValue.serverTimestamp(),
      })
    } else {
      summary.skipped++
    }
  }

  summary.status = 'sent'
  await adminDb.collection('rss_automations').doc(doc.id).update({
    lastRunAt: Timestamp.fromDate(now),
    lastPostGuid: fresh[0].guid,
    lastSentCount: summary.sent,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return summary
}

async function handle(req: NextRequest): Promise<Response> {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return apiError('Unauthorized', 401)
  }

  const now = new Date()
  const snap = await adminDb.collection('rss_automations').where('enabled', '==', true).get()

  const results: RunSummary[] = []
  let processed = 0
  for (const doc of snap.docs) {
    if (doc.data()?.deleted) continue
    try {
      const summary = await processAutomation(
        doc as unknown as { id: string; data: () => Record<string, unknown> },
        now,
      )
      if (summary) {
        results.push(summary)
        processed++
      }
    } catch (err) {
      console.error('[email/rss-automations/run] automation failed', doc.id, err)
    }
  }

  return apiSuccess({ processed, results })
}

export const GET = handle
export const POST = handle
