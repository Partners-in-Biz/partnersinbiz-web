// lib/sms/send.ts
//
// Single-contact send pipeline for SMS. Shared by:
//   • app/api/cron/sequences/route.ts          — when a SequenceStep is channel='sms'
//   • app/api/cron/broadcasts/route.ts         — when a Broadcast is channel='sms'
//   • app/api/v1/sms/send/route.ts             — one-off / transactional SMS
//
// Responsibilities per contact:
//   1. Load contact + validate phone (normalises to E.164 with org default)
//   2. Preferences gate (lib/preferences/store > shouldSendToContact, channel='sms')
//   3. Suppression check (lib/email/suppressions > isSuppressed, channel='sms')
//   4. Frequency cap (lib/email/frequency > isWithinFrequencyCap — channel-agnostic)
//   5. Twilio send via lib/sms/twilio
//   6. Write sms doc, log activity, roll up broadcast/campaign stats
//   7. Return outcome
//
// Returns `status: 'skipped'` for legitimate non-sends (no phone, suppressed,
// prefs gate blocked, etc.) so callers can stat them separately from failures.

import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { isValidE164, normalizeToE164, countSmsSegments } from '@/lib/sms/twilio'
import { sendOrgSms } from '@/lib/twilio/sms'
import { isSuppressed } from '@/lib/email/suppressions'
import { shouldSendToContact } from '@/lib/preferences/store'
import { isWithinFrequencyCap, logFrequencySkip } from '@/lib/email/frequency'
import type { Contact } from '@/lib/crm/types'

export interface SmsSendOptions {
  orgId: string
  contactId: string
  body: string
  topicId?: string
  campaignId?: string
  broadcastId?: string
  sequenceId?: string
  sequenceStep?: number | null
  variantId?: string
  scheduledFor?: Date
  /**
   * Optional override for the from-number. Normally the messaging-service-sid
   * is used (preferred). Only set this when you specifically need a single
   * number for compliance reasons.
   */
  fromOverride?: string
}

export interface SmsSendOutcome {
  status: 'sent' | 'failed' | 'skipped'
  reason?: string
  twilioSid?: string
  smsId?: string
  segmentsCount?: number
}

/**
 * Rough cost-per-segment estimate in USD. Twilio's actual rates vary by
 * destination — this is a stamp for the doc so the admin can see ballpark
 * cost; the real cost arrives via the status callback later.
 *
 * Defaults to the US rate. South Africa is ~$0.04/seg; we override based on
 * country code prefix.
 */
function estimateCostUsd(e164: string, segments: number): number {
  if (!e164.startsWith('+')) return segments * 0.0075
  if (e164.startsWith('+1')) return segments * 0.0075
  if (e164.startsWith('+27')) return segments * 0.04
  if (e164.startsWith('+44')) return segments * 0.04
  if (e164.startsWith('+61')) return segments * 0.05
  return segments * 0.05
}

async function loadOrgDefaultCountry(orgId: string): Promise<string> {
  try {
    const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
    if (!orgSnap.exists) return 'ZA'
    const data = orgSnap.data() ?? {}
    const country =
      typeof data?.settings?.smsDefaultCountry === 'string' && data.settings.smsDefaultCountry
        ? data.settings.smsDefaultCountry
        : typeof data?.country === 'string' && data.country
          ? data.country
          : 'ZA'
    return String(country).toUpperCase()
  } catch {
    return 'ZA'
  }
}

export async function sendSmsToContact(opts: SmsSendOptions): Promise<SmsSendOutcome> {
  const { orgId, contactId } = opts
  const topicId = (opts.topicId || 'newsletter').toLowerCase()
  const body = (opts.body ?? '').trim()

  if (!orgId || !contactId) {
    return { status: 'failed', reason: 'missing orgId or contactId' }
  }
  if (!body) {
    return { status: 'failed', reason: 'empty body' }
  }

  // 1. Load contact.
  const cSnap = await adminDb.collection('contacts').doc(contactId).get()
  if (!cSnap.exists) {
    return { status: 'failed', reason: 'contact not found' }
  }
  const contact = { id: cSnap.id, ...cSnap.data() } as Contact
  if (contact.orgId && contact.orgId !== orgId) {
    return { status: 'failed', reason: 'contact orgId mismatch' }
  }

  // 2. Normalise phone.
  const rawPhone = (contact.phone ?? '').trim()
  if (!rawPhone) {
    return { status: 'skipped', reason: 'contact has no phone' }
  }
  const defaultCountry = await loadOrgDefaultCountry(orgId)
  const e164 = normalizeToE164(rawPhone, defaultCountry)
  if (!e164 || !isValidE164(e164)) {
    return { status: 'skipped', reason: `unable to parse phone "${rawPhone}" to E.164` }
  }

  // 3. Preferences gate.
  const prefs = await shouldSendToContact({ contactId, orgId, topicId, channel: 'sms' })
  if (!prefs.allowed) {
    return { status: 'skipped', reason: prefs.reason ?? 'blocked by preferences' }
  }

  // 4. SMS suppression check.
  if (await isSuppressed(orgId, e164, 'sms')) {
    return { status: 'skipped', reason: 'sms-suppressed' }
  }

  // 5. Frequency cap (shared across channels — same per-contact budget).
  const freqCheck = await isWithinFrequencyCap(orgId, contactId, topicId)
  if (!freqCheck.allowed) {
    await logFrequencySkip({
      orgId,
      contactId,
      topicId,
      source: opts.broadcastId
        ? 'broadcast'
        : opts.sequenceId
          ? 'sequence'
          : 'transactional',
      sourceId: opts.broadcastId ?? opts.sequenceId ?? opts.campaignId ?? '',
      reason: freqCheck.reason ?? 'frequency cap',
    })
    return { status: 'skipped', reason: freqCheck.reason ?? 'frequency cap' }
  }

  // 6. Send via Twilio (per-org credentials preferred).
  const segInfo = countSmsSegments(body)
  const sendResult = await sendOrgSms({
    orgId,
    to: e164,
    body,
    from: opts.fromOverride,
    allowPlatformFallback: true,
  })

  // 7. Persist the sms doc no matter what — failed sends are useful audit
  //    trail and let webhooks roll up status later. Skipped sends are caught
  //    above and don't reach here.
  const segmentsCount = sendResult.segmentsCount || segInfo.segments
  const docPayload: Record<string, unknown> = {
    orgId,
    direction: 'outbound',
    contactId,
    twilioSid: sendResult.twilioSid,
    from: (opts.fromOverride ?? '').trim() || '',
    to: e164,
    body,
    status: sendResult.ok ? 'sent' : 'failed',
    segmentsCount,
    costEstimateUsd: estimateCostUsd(e164, segmentsCount),
    sequenceId: opts.sequenceId ?? '',
    sequenceStep: opts.sequenceStep ?? null,
    campaignId: opts.campaignId ?? '',
    broadcastId: opts.broadcastId ?? '',
    topicId,
    variantId: opts.variantId ?? '',
    sentAt: sendResult.ok ? FieldValue.serverTimestamp() : null,
    deliveredAt: null,
    failedAt: sendResult.ok ? null : FieldValue.serverTimestamp(),
    failureReason: sendResult.ok ? '' : sendResult.error ?? '',
    scheduledFor: opts.scheduledFor ? Timestamp.fromDate(opts.scheduledFor) : null,
    createdAt: FieldValue.serverTimestamp(),
    deleted: false,
  }
  const smsRef = await adminDb.collection('sms').add(docPayload)

  // 8. Roll up stats on broadcast / campaign if applicable.
  if (opts.broadcastId) {
    try {
      const statField = sendResult.ok ? 'stats.sent' : 'stats.failed'
      await adminDb.collection('broadcasts').doc(opts.broadcastId).update({
        [statField]: FieldValue.increment(1),
        'stats.queued': FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sms/send] broadcast stat rollup failed', err)
    }
  }
  if (sendResult.ok && opts.campaignId) {
    try {
      await adminDb.collection('campaigns').doc(opts.campaignId).update({
        'stats.sent': FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sms/send] campaign stat rollup failed', err)
    }
  }

  // 9. Activity log (best-effort, only on success).
  if (sendResult.ok) {
    try {
      await adminDb.collection('activities').add({
        orgId,
        contactId,
        dealId: '',
        type: 'sms_sent',
        summary: `SMS sent: ${body.slice(0, 80)}${body.length > 80 ? '…' : ''}`,
        metadata: {
          smsId: smsRef.id,
          twilioSid: sendResult.twilioSid,
          broadcastId: opts.broadcastId ?? '',
          sequenceId: opts.sequenceId ?? '',
          campaignId: opts.campaignId ?? '',
          segments: segmentsCount,
        },
        createdAt: FieldValue.serverTimestamp(),
        createdBy: 'system',
      })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[sms/send] activity log failed', err)
    }
  }

  if (!sendResult.ok) {
    return {
      status: 'failed',
      reason: sendResult.error,
      twilioSid: sendResult.twilioSid,
      smsId: smsRef.id,
      segmentsCount,
    }
  }

  return {
    status: 'sent',
    twilioSid: sendResult.twilioSid,
    smsId: smsRef.id,
    segmentsCount,
  }
}
