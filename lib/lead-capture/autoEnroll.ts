// lib/lead-capture/autoEnroll.ts
//
// Auto-enrolls a captured contact into:
//   1. Each sequence in `source.sequenceIdsToEnroll` (direct, no campaign)
//   2. Each campaign in `source.campaignIdsToEnroll` (only if active)
//   3. All active campaigns whose `triggers.captureSourceIds` contains
//      the source id (and which the source operator didn't already pick).
//
// Idempotent: skips contacts already enrolled in the same sequence
// (when no campaign) or the same campaign+contact pair.
//
// Used by both the public submit endpoint (when DOI is off) and the DOI
// confirmation endpoint.

import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { CaptureSource, CaptureSubmission } from './types'
import type { Sequence } from '@/lib/sequences/types'
import type { Campaign } from '@/lib/campaigns/types'
import { assertEmailMarketingDispatchApproval } from '@/lib/email-marketing/agent-governance'

export interface AutoEnrollResult {
  enrolledSequences: number
  enrolledCampaigns: number
}

interface ContactEnvelope {
  email: string
  unsubscribedAt?: unknown
  bouncedAt?: unknown
  deleted?: boolean
  orgId?: string
}

function isLiveContact(c: ContactEnvelope | null | undefined): boolean {
  if (!c) return false
  if (c.deleted === true) return false
  if (c.unsubscribedAt) return false
  if (c.bouncedAt) return false
  return true
}

async function getSequence(id: string): Promise<Sequence | null> {
  if (!id) return null
  const snap = await adminDb.collection('sequences').doc(id).get()
  if (!snap.exists) return null
  const data = snap.data() as Sequence | undefined
  if (!data) return null
  if (data.deleted) return null
  return { ...data, id: snap.id }
}

async function getCampaign(id: string): Promise<Campaign | null> {
  if (!id) return null
  const snap = await adminDb.collection('campaigns').doc(id).get()
  if (!snap.exists) return null
  const data = snap.data() as Campaign | undefined
  if (!data) return null
  if (data.deleted) return null
  return { ...data, id: snap.id }
}

async function enrollmentExists(opts: {
  contactId: string
  sequenceId: string
  campaignId: string
}): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = adminDb
    .collection('sequence_enrollments')
    .where('contactId', '==', opts.contactId)
    .where('sequenceId', '==', opts.sequenceId)
  if (opts.campaignId) {
    q = q.where('campaignId', '==', opts.campaignId)
  }
  const snap = await q.limit(1).get()
  return !snap.empty
}

function firstStepDelayMs(seq: Sequence): number {
  const first = seq.steps?.[0]
  return (first?.delayDays ?? 0) * 24 * 60 * 60 * 1000
}

async function logActivity(
  orgId: string,
  contactId: string,
  type: string,
  summary: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await adminDb.collection('activities').add({
      orgId,
      contactId,
      type,
      summary,
      note: summary,
      metadata,
      createdBy: 'lead-capture',
      createdAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[lead-capture] activity log failed', err)
  }
}

export async function performAutoEnroll(
  submission: CaptureSubmission,
  source: CaptureSource,
): Promise<AutoEnrollResult> {
  const contactSnap = await adminDb.collection('contacts').doc(submission.contactId).get()
  if (!contactSnap.exists) {
    return { enrolledSequences: 0, enrolledCampaigns: 0 }
  }
  const contact = contactSnap.data() as ContactEnvelope | undefined
  if (!isLiveContact(contact)) {
    return { enrolledSequences: 0, enrolledCampaigns: 0 }
  }
  if (contact?.orgId && contact.orgId !== source.orgId) {
    // Org mismatch safeguard
    return { enrolledSequences: 0, enrolledCampaigns: 0 }
  }

  await logActivity(
    source.orgId,
    submission.contactId,
    'lead_captured',
    `Captured via "${source.name}"`,
    {
      sourceId: source.id,
      sourceType: source.type,
      submissionId: submission.id,
      email: submission.email,
    },
  )

  let enrolledSequences = 0
  let enrolledCampaigns = 0

  // ── 1. Direct sequence enrollments ───────────────────────────────────────
  for (const sequenceId of source.sequenceIdsToEnroll ?? []) {
    try {
      const sequence = await getSequence(sequenceId)
      if (!sequence) continue
      if (sequence.orgId && sequence.orgId !== source.orgId) continue
      if (sequence.status !== 'active') continue
      if (!sequence.steps?.length) continue
      await assertEmailMarketingDispatchApproval(sequence as unknown as Record<string, unknown>, {
        orgId: source.orgId, resourceType: 'email_sequence', resourceId: sequenceId,
      })

      if (await enrollmentExists({ contactId: submission.contactId, sequenceId, campaignId: '' })) {
        continue
      }

      const nextSendAt = Timestamp.fromDate(new Date(Date.now() + firstStepDelayMs(sequence)))

      await adminDb.collection('sequence_enrollments').add({
        orgId: source.orgId,
        campaignId: '',
        sequenceId,
        contactId: submission.contactId,
        status: 'active',
        currentStep: 0,
        enrolledAt: FieldValue.serverTimestamp(),
        nextSendAt,
        deleted: false,
      })

      await logActivity(
        source.orgId,
        submission.contactId,
        'sequence_enrolled',
        `Enrolled in sequence: ${sequence.name}`,
        { sequenceId, sourceId: source.id, submissionId: submission.id },
      )

      enrolledSequences += 1
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[lead-capture] sequence enrollment failed', { sequenceId }, err)
    }
  }

  // ── 2. Direct campaign enrollments ───────────────────────────────────────
  const enrolledCampaignIds = new Set<string>()

  for (const campaignId of source.campaignIdsToEnroll ?? []) {
    try {
      const campaign = await getCampaign(campaignId)
      if (!campaign) continue
      if (campaign.orgId !== source.orgId) continue
      // Allow draft+active+scheduled — only skip paused/completed/explicitly off
      if (campaign.status !== 'active' && campaign.status !== 'scheduled' && campaign.status !== 'draft') {
        continue
      }
      if (!campaign.sequenceId) continue
      await assertEmailMarketingDispatchApproval(campaign as unknown as Record<string, unknown>, {
        orgId: source.orgId, resourceType: 'email_campaign', resourceId: campaignId,
      })

      const sequence = await getSequence(campaign.sequenceId)
      if (!sequence) continue
      if (!sequence.steps?.length) continue

      if (
        await enrollmentExists({
          contactId: submission.contactId,
          sequenceId: campaign.sequenceId,
          campaignId,
        })
      ) {
        enrolledCampaignIds.add(campaignId)
        continue
      }

      const nextSendAt = Timestamp.fromDate(new Date(Date.now() + firstStepDelayMs(sequence)))

      await adminDb.collection('sequence_enrollments').add({
        orgId: source.orgId,
        campaignId,
        sequenceId: campaign.sequenceId,
        contactId: submission.contactId,
        status: 'active',
        currentStep: 0,
        enrolledAt: FieldValue.serverTimestamp(),
        nextSendAt,
        deleted: false,
      })

      await adminDb.collection('campaigns').doc(campaignId).update({
        'stats.enrolled': FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      })

      await logActivity(
        source.orgId,
        submission.contactId,
        'sequence_enrolled',
        `Auto-enrolled in campaign: ${campaign.name}`,
        { campaignId, sequenceId: campaign.sequenceId, sourceId: source.id, submissionId: submission.id },
      )

      enrolledCampaigns += 1
      enrolledCampaignIds.add(campaignId)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[lead-capture] direct campaign enrollment failed', { campaignId }, err)
    }
  }

  // ── 3. Trigger-matched active campaigns ──────────────────────────────────
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const triggeredSnap = await (adminDb.collection('campaigns') as any)
      .where('orgId', '==', source.orgId)
      .where('status', '==', 'active')
      .where('triggers.captureSourceIds', 'array-contains', source.id)
      .get()

    for (const doc of triggeredSnap.docs) {
      const campaign = { ...(doc.data() as Campaign), id: doc.id }
      if (campaign.deleted) continue
      if (enrolledCampaignIds.has(campaign.id)) continue
      if (!campaign.sequenceId) continue
      await assertEmailMarketingDispatchApproval(campaign as unknown as Record<string, unknown>, {
        orgId: source.orgId, resourceType: 'email_campaign', resourceId: campaign.id,
      })

      const sequence = await getSequence(campaign.sequenceId)
      if (!sequence) continue
      if (!sequence.steps?.length) continue

      if (
        await enrollmentExists({
          contactId: submission.contactId,
          sequenceId: campaign.sequenceId,
          campaignId: campaign.id,
        })
      ) {
        continue
      }

      const nextSendAt = Timestamp.fromDate(new Date(Date.now() + firstStepDelayMs(sequence)))

      await adminDb.collection('sequence_enrollments').add({
        orgId: source.orgId,
        campaignId: campaign.id,
        sequenceId: campaign.sequenceId,
        contactId: submission.contactId,
        status: 'active',
        currentStep: 0,
        enrolledAt: FieldValue.serverTimestamp(),
        nextSendAt,
        deleted: false,
      })

      await doc.ref.update({
        'stats.enrolled': FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      })

      await logActivity(
        source.orgId,
        submission.contactId,
        'sequence_enrolled',
        `Auto-enrolled via trigger in campaign: ${campaign.name}`,
        { campaignId: campaign.id, sequenceId: campaign.sequenceId, sourceId: source.id, submissionId: submission.id },
      )

      enrolledCampaigns += 1
      enrolledCampaignIds.add(campaign.id)
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[lead-capture] trigger-matched campaign enrollment failed', err)
  }

  return { enrolledSequences, enrolledCampaigns }
}
