// lib/campaigns/launch.ts
//
// Shared enrollment logic for launching an email-program campaign. Resolves
// the campaign's audience (segment OR explicit contacts), enrols matching
// contacts into the campaign's sequence, and flips the campaign to `active`.
//
// Used by:
//   - POST /api/v1/campaigns/[id]/launch       (manual "Send now")
//   - POST /api/v1/campaigns/run-scheduled      (cron — fires due scheduled sends)
//
// Idempotent: skips contacts already enrolled in the campaign, and skips
// unsubscribed/bounced/cross-org contacts.

import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { Campaign } from '@/lib/campaigns/types'
import type { Sequence } from '@/lib/sequences/types'
import type { Contact } from '@/lib/crm/types'
import { resolveSegmentContacts } from '@/lib/crm/segments'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'

export interface LaunchResult {
  ok: boolean
  status: number
  error?: string
  enrolled?: number
  audienceSize?: number
}

/**
 * Enrol a campaign's audience into its sequence and set status=active.
 *
 * `actorUid` is recorded on the contact activity entries. The caller is
 * responsible for org-scoping the campaign before invoking this.
 */
export async function launchCampaign(
  campaign: Campaign & { exclusionContactIds?: string[]; tagId?: string },
  ref: FirebaseFirestore.DocumentReference,
): Promise<LaunchResult> {
  if (campaign.status === 'active') return { ok: false, status: 422, error: 'Campaign is already active' }
  if (campaign.status === 'completed') return { ok: false, status: 422, error: 'Campaign is already completed' }
  if (!campaign.sequenceId) return { ok: false, status: 422, error: 'Campaign has no sequence — set sequenceId first' }

  const hasAudience =
    !!campaign.segmentId ||
    !!campaign.tagId ||
    (Array.isArray(campaign.contactIds) && campaign.contactIds.length > 0)
  if (!hasAudience) {
    return { ok: false, status: 422, error: 'Campaign has no audience — set a segment, tag, or contacts first' }
  }

  const seqSnap = await adminDb.collection('sequences').doc(campaign.sequenceId).get()
  if (!seqSnap.exists || seqSnap.data()?.deleted) return { ok: false, status: 422, error: 'Sequence not found' }
  const sequence = { id: seqSnap.id, ...seqSnap.data() } as Sequence
  if (sequence.orgId !== campaign.orgId) return { ok: false, status: 403, error: 'Sequence belongs to a different org' }
  if (!sequence.steps?.length) return { ok: false, status: 422, error: 'Sequence has no steps' }

  // Resolve audience → contact-id list
  let contactIds: string[] = []
  if (campaign.segmentId) {
    const segSnap = await adminDb.collection('segments').doc(campaign.segmentId).get()
    if (!segSnap.exists || segSnap.data()?.deleted) return { ok: false, status: 422, error: 'Segment not found' }
    if (segSnap.data()?.orgId !== campaign.orgId) return { ok: false, status: 403, error: 'Segment belongs to a different org' }
    const filters = segSnap.data()?.filters ?? {}
    const contacts = await resolveSegmentContacts(campaign.orgId, filters)
    contactIds = contacts.map((c: Contact) => c.id)
  } else if (campaign.tagId) {
    const contacts = await resolveSegmentContacts(campaign.orgId, { tags: [campaign.tagId] })
    contactIds = contacts.map((c: Contact) => c.id)
  } else {
    contactIds = [...campaign.contactIds]
  }

  // Apply the exclusion list
  const excluded = new Set<string>(
    Array.isArray(campaign.exclusionContactIds)
      ? campaign.exclusionContactIds.filter((v): v is string => typeof v === 'string')
      : [],
  )
  contactIds = contactIds.filter((cid) => !excluded.has(cid))

  if (contactIds.length === 0) {
    return { ok: false, status: 422, error: 'Audience is empty — campaign has no contacts to enrol' }
  }

  const firstStep = sequence.steps[0]
  const delayMs = (firstStep.delayDays ?? 0) * 24 * 60 * 60 * 1000
  const nextSendAt = Timestamp.fromDate(new Date(Date.now() + delayMs))

  let enrolledCount = 0
  for (const contactId of contactIds) {
    const cSnap = await adminDb.collection('contacts').doc(contactId).get()
    if (!cSnap.exists) continue
    const c = cSnap.data() as Contact
    if (c.deleted || c.orgId !== campaign.orgId) continue
    if (c.unsubscribedAt || c.bouncedAt) continue

    const existing = await adminDb
      .collection('sequence_enrollments')
      .where('campaignId', '==', campaign.id)
      .where('contactId', '==', contactId)
      .limit(1)
      .get()
    if (!existing.empty) continue

    await adminDb.collection('sequence_enrollments').add({
      orgId: campaign.orgId,
      campaignId: campaign.id,
      sequenceId: sequence.id,
      contactId,
      status: 'active',
      currentStep: 0,
      enrolledAt: FieldValue.serverTimestamp(),
      nextSendAt,
      deleted: false,
    })

    await adminDb.collection('activities').add({
      orgId: campaign.orgId,
      contactId,
      type: 'sequence_enrolled',
      summary: `Enrolled in campaign: ${campaign.name}`,
      metadata: { campaignId: campaign.id, sequenceId: sequence.id },
      createdAt: FieldValue.serverTimestamp(),
    })

    enrolledCount++
  }

  await ref.update({
    status: 'active',
    startAt: FieldValue.serverTimestamp(),
    scheduledAt: null,
    'stats.enrolled': FieldValue.increment(enrolledCount),
    updatedAt: FieldValue.serverTimestamp(),
  })

  try {
    await dispatchWebhook(campaign.orgId, 'campaign.launched', {
      id: campaign.id,
      name: campaign.name,
      enrolled: enrolledCount,
      audienceSize: contactIds.length,
    })
  } catch (err) {
    console.error('[webhook-dispatch-error] campaign.launched', err)
  }

  return { ok: true, status: 200, enrolled: enrolledCount, audienceSize: contactIds.length }
}
