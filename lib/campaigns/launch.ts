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
import type { Contact } from '@/lib/crm/types'
import type { Sequence } from '@/lib/sequences/types'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import type { AudienceDefinition } from '@/lib/email-marketing/audience-types'
import { sanitizeAudienceDefinition } from '@/lib/email-marketing/audience-snapshot'
import { estimateAudienceDefinition } from '@/lib/email-marketing/audience-resolver'
import { createAudienceVersion } from '@/lib/email-marketing/audience-version-store'
import { getSenderPolicy } from '@/lib/email-marketing/sender-store'
import { runEmailPreflight } from '@/lib/email-marketing/preflight'
import type { EmailDocument } from '@/lib/email-builder/types'

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
  campaign: Campaign & {
    exclusionContactIds?: string[]
    tagId?: string
    audienceDefinition?: AudienceDefinition | null
    createdBy?: string
  },
  ref: FirebaseFirestore.DocumentReference,
): Promise<LaunchResult> {
  if (campaign.status === 'active') return { ok: false, status: 422, error: 'Campaign is already active' }
  if (campaign.status === 'completed') return { ok: false, status: 422, error: 'Campaign is already completed' }
  if (campaign.createdByType === 'agent' && campaign.approvalState?.status !== 'approved') {
    return { ok: false, status: 403, error: 'Agent-created campaigns require human approval before launch' }
  }
  const emailDocument = (campaign as Campaign & { emailDocument?: EmailDocument | null }).emailDocument
  if (emailDocument) {
    const preflight = runEmailPreflight(emailDocument)
    if (preflight.blocking) {
      const blockers = preflight.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message)
      return { ok: false, status: 422, error: `Email preflight failed: ${blockers.join(' ')}` }
    }
  }
  if (!campaign.sequenceId) return { ok: false, status: 422, error: 'Campaign has no sequence — set sequenceId first' }

  const hasAudience =
    !!campaign.audienceDefinition ||
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

  const senderPolicyId = campaign.senderPolicyId?.trim() ?? ''
  if (senderPolicyId) {
    const senderPolicy = await getSenderPolicy(campaign.orgId, senderPolicyId)
    if (!senderPolicy?.enabled) {
      return { ok: false, status: 422, error: 'Sender policy is unavailable or disabled' }
    }
    if (!['lifecycle', 'sales_1to1'].includes(senderPolicy.purpose)) {
      return { ok: false, status: 422, error: 'Sender policy purpose is not valid for a sequence campaign' }
    }
  }

  // Freeze a server-resolved audience version at launch. Legacy selectors are
  // adapted into the canonical definition so every path gets the same
  // suppression, preference, frequency, dedupe, and tenant checks.
  const legacyInclude = campaign.segmentId
    ? [{ type: 'segment' as const, segmentId: campaign.segmentId }]
    : campaign.tagId
      ? [{ type: 'tags' as const, tags: [campaign.tagId] }]
      : [{
          type: 'contacts' as const,
          contactIds: Array.isArray(campaign.contactIds) ? [...campaign.contactIds] : [],
        }]
  const rawDefinition = campaign.audienceDefinition ?? {
    schemaVersion: 1,
    include: legacyInclude,
    exclude: campaign.exclusionContactIds?.length
      ? [{ type: 'contacts' as const, contactIds: campaign.exclusionContactIds }]
      : undefined,
    topicId: sequence.topicId ?? 'newsletter',
    holdoutPercent: 0,
  }
  let definition: AudienceDefinition
  try {
    definition = sanitizeAudienceDefinition(rawDefinition)
  } catch (error) {
    return {
      ok: false,
      status: 422,
      error: error instanceof Error ? error.message : 'Audience definition is invalid',
    }
  }
  const estimate = await estimateAudienceDefinition(campaign.orgId, definition, {
    holdoutSeed: campaign.id,
  })
  const contactIds = estimate.eligibleContactIds

  if (contactIds.length === 0) {
    return { ok: false, status: 422, error: 'Audience is empty — campaign has no contacts to enrol' }
  }

  const audienceVersion = await createAudienceVersion({
    orgId: campaign.orgId,
    programId: campaign.id,
    createdBy: campaign.createdBy ?? 'system',
    definition,
    estimate,
  })

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
      audienceVersionId: audienceVersion.id,
      senderPolicyId,
      replyPolicyId: campaign.replyPolicyId?.trim() ?? '',
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
    audienceVersionId: audienceVersion.id,
    audienceDefinition: definition,
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
