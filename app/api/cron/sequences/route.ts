// app/api/cron/sequences/route.ts
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { apiSuccess, apiError } from '@/lib/api/response'
import { sendCampaignEmail } from '@/lib/email/resend'
import { resolveFrom } from '@/lib/email/resolveFrom'
import { interpolate, varsFromContact } from '@/lib/email/template'
import { signUnsubscribeToken } from '@/lib/email/unsubscribeToken'
import { isSuppressed } from '@/lib/email/suppressions'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { pickVariantForSend, incrementVariantStat } from '@/lib/ab-testing/cronHelpers'
import { applyVariantOverrides } from '@/lib/ab-testing/apply'
import type { AbConfig } from '@/lib/ab-testing/types'
import { shouldSendToContact } from '@/lib/preferences/store'
import { isWithinFrequencyCap, logFrequencySkip } from '@/lib/email/frequency'
import { pickSendTime, type SendTimeContext } from '@/lib/email/send-time'
import type {
  SequenceStep,
  SequenceGoal,
  SequenceBranch,
  EnrollmentPathEntry,
} from '@/lib/sequences/types'
import type { Contact } from '@/lib/crm/types'
import { evaluateCondition, findHitGoal, type EvaluationContext } from '@/lib/sequences/conditions'
import { sendSmsToContact } from '@/lib/sms/send'
import { randomUUID } from 'crypto'
import { getSenderPolicy } from '@/lib/email-marketing/sender-store'
import { resolveSenderForRecipient } from '@/lib/email-marketing/sender-resolution'
import { buildSenderRecipientContext } from '@/lib/email-marketing/sender-context'
import { resolveCanonicalEmailConsent } from '@/lib/consent-ledger/decision'
import { assertEmailMarketingDispatchApproval } from '@/lib/email-marketing/agent-governance'
import { approvalResourceForSequenceRuntime, runtimeSequenceForEnrollment } from '@/lib/sequences/workflow-version'
import { evaluateQuietHours } from '@/lib/sequences/scheduling'
import { deliveryFailureState } from '@/lib/sequences/delivery'
import { goalCompletionState } from '@/lib/sequences/goals'

export const dynamic = 'force-dynamic'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://partnersinbiz.online'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const LEASE_MS = 10 * 60 * 1000

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) return apiError('Unauthorized', 401)

  const now = Timestamp.now()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = await (adminDb.collection('sequence_enrollments') as any)
    .where('status', '==', 'active')
    .where('nextSendAt', '<=', now)
    .limit(100)
    .get()

  let processed = 0

  for (const enrollDoc of snap.docs) {
    const leaseToken = randomUUID()
    let leaseAcquired = false
    try {
      leaseAcquired = await acquireEnrollmentLease(enrollDoc.id, leaseToken, now)
      if (!leaseAcquired) continue
      const enrollment = enrollDoc.data()
      const enrollmentOrgId: string = enrollment.orgId ?? ''
      if (!enrollmentOrgId) throw new Error('Enrollment has no organisation boundary')

      const seqSnap = await adminDb.collection('sequences').doc(enrollment.sequenceId).get()
      if (!seqSnap.exists) continue
      const editableSequence = { ...(seqSnap.data() ?? {}), id: enrollment.sequenceId } as import('@/lib/sequences/types').Sequence
      if (editableSequence.orgId !== enrollmentOrgId) throw new Error('Sequence organisation mismatch')
      if (editableSequence.deleted || editableSequence.status !== 'active') {
        await enrollDoc.ref.update({
          status: 'paused',
          pausedReason: editableSequence.deleted ? 'sequence-deleted' : 'sequence-not-active',
          nextSendAt: null,
          updatedAt: FieldValue.serverTimestamp(),
        })
        continue
      }
      let seq: ReturnType<typeof runtimeSequenceForEnrollment>
      try {
        seq = runtimeSequenceForEnrollment(editableSequence, enrollment)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid workflow pin'
        await enrollDoc.ref.update({
          status: 'paused',
          pausedReason: 'invalid-workflow-pin',
          workflowValidationError: message.slice(0, 500),
          workflowValidationFailedAt: now,
          nextSendAt: null,
          updatedAt: FieldValue.serverTimestamp(),
        })
        await adminDb.collection('activities').add({
          orgId: enrollmentOrgId,
          contactId: enrollment.contactId,
          type: 'sequence_workflow_validation_failed',
          summary: 'Sequence enrollment paused because its immutable workflow pin failed validation',
          metadata: { sequenceId: enrollment.sequenceId, enrollmentId: enrollDoc.id, reason: message.slice(0, 500) },
          createdAt: FieldValue.serverTimestamp(),
        })
        continue
      }
      try {
        await assertEmailMarketingDispatchApproval(approvalResourceForSequenceRuntime(seq), {
          orgId: enrollmentOrgId, resourceType: 'email_sequence', resourceId: enrollment.sequenceId,
        })
      } catch (error) {
        await adminDb.collection('sequence_enrollments').doc(enrollDoc.id).update({
          status: 'paused',
          pausedReason: error instanceof Error ? error.message : 'approval invalid',
          updatedAt: FieldValue.serverTimestamp(),
        })
        continue
      }
      const steps: SequenceStep[] = seq.steps ?? []
      const goals: SequenceGoal[] | undefined = seq.goals

      const contactSnap = await adminDb.collection('contacts').doc(enrollment.contactId).get()
      if (!contactSnap.exists) continue
      const contact = { id: contactSnap.id, ...contactSnap.data() } as Contact
      if (contact.orgId !== enrollmentOrgId) throw new Error('Contact organisation mismatch')

      // Hard-block: skip and exit if contact has bounced or unsubscribed.
      if (contact.bouncedAt || contact.unsubscribedAt) {
        await adminDb.collection('sequence_enrollments').doc(enrollDoc.id).update({
          status: 'exited',
          exitReason: contact.bouncedAt ? 'bounced' : 'unsubscribed',
          updatedAt: FieldValue.serverTimestamp(),
        })
        continue
      }

      // Suppression check (covers complaints, hard bounces from another
      // campaign, and live soft-bounce holds). Exit the enrollment with
      // `bounced` so it doesn't get re-picked next tick.
      if (
        enrollmentOrgId &&
        contact.email &&
        (await isSuppressed(enrollmentOrgId, contact.email))
      ) {
        await adminDb.collection('sequence_enrollments').doc(enrollDoc.id).update({
          status: 'exited',
          exitReason: 'bounced',
          updatedAt: FieldValue.serverTimestamp(),
        })
        continue
      }

      // ── Branch evaluation phase ────────────────────────────────────────
      // If the enrollment is in a "pendingBranchEvalAt" window AND that
      // instant has been reached, evaluate branches and advance.
      const nowDate = now.toDate()
      const pendingEvalMs: number | null =
        enrollment.pendingBranchEvalAt && typeof enrollment.pendingBranchEvalAt.toMillis === 'function'
          ? enrollment.pendingBranchEvalAt.toMillis()
          : null

      if (pendingEvalMs !== null && pendingEvalMs <= nowDate.getTime()) {
        const sentStep = steps[enrollment.currentStep]
        const branch = sentStep?.branch as SequenceBranch | undefined
        const evalCtx: EvaluationContext = {
          orgId: enrollmentOrgId,
          contact,
          sequenceId: enrollment.sequenceId,
          stepNumber: enrollment.currentStep,
          enrolledAt: enrollment.enrolledAt ?? null,
          now: nowDate,
          goals,
        }

        // Goals are checked first — they short-circuit even branch waits.
        const hit = await findHitGoal(goals, evalCtx)
        if (hit) {
          await exitWithGoal(enrollDoc.id, enrollmentOrgId, contact.id, hit, enrollment.path)
          continue
        }

        let nextStepNumber = enrollment.currentStep + 1
        let matchedRuleIndex = -1
        let matchedCondition = undefined as
          | undefined
          | SequenceBranch['rules'][number]['condition']
        if (branch) {
          for (let i = 0; i < branch.rules.length; i++) {
            const rule = branch.rules[i]
            let matched = false
            try {
              matched = await evaluateCondition(rule.condition, evalCtx)
            } catch (err) {
              console.error('[cron/sequences] branch rule eval failed', err)
            }
            if (matched) {
              nextStepNumber = rule.nextStepNumber
              matchedRuleIndex = i
              matchedCondition = rule.condition
              break
            }
          }
          if (matchedRuleIndex === -1) {
            nextStepNumber = branch.defaultNextStepNumber
          }
        }

        // -1 means exit.
        if (nextStepNumber < 0) {
          await adminDb.collection('sequence_enrollments').doc(enrollDoc.id).update({
            status: 'exited',
            exitReason: 'branch-exit',
            pendingBranchEvalAt: null,
            path: appendPath(enrollment.path, {
              stepNumber: enrollment.currentStep,
              branchTaken: {
                matchedRuleIndex,
                condition: matchedCondition,
                nextStepNumber,
              },
              at: now,
            }),
            updatedAt: FieldValue.serverTimestamp(),
          })
          continue
        }

        // Bounds check.
        if (nextStepNumber >= steps.length) {
          await adminDb.collection('sequence_enrollments').doc(enrollDoc.id).update({
            status: 'completed',
            exitReason: 'completed',
            completedAt: FieldValue.serverTimestamp(),
            pendingBranchEvalAt: null,
            path: appendPath(enrollment.path, {
              stepNumber: enrollment.currentStep,
              branchTaken: {
                matchedRuleIndex,
                condition: matchedCondition,
                nextStepNumber,
              },
              at: now,
            }),
            updatedAt: FieldValue.serverTimestamp(),
          })
          continue
        }

        // Cycle guard.
        const visited: number[] = Array.isArray(enrollment.visitedSteps)
          ? enrollment.visitedSteps
          : []
        if (visited.includes(nextStepNumber)) {
          await adminDb.collection('sequence_enrollments').doc(enrollDoc.id).update({
            status: 'exited',
            exitReason: 'cycle-detected',
            pendingBranchEvalAt: null,
            updatedAt: FieldValue.serverTimestamp(),
          })
          continue
        }

        // Compute nextSendAt for the new step.
        const orgMeta = await loadOrgMeta(enrollmentOrgId)
        const nextStep = steps[nextStepNumber]
        const nextDelayMs = (nextStep.delayDays ?? 0) * DAY_MS
        const baseNext = new Date(nowDate.getTime() + nextDelayMs)
        const sendCtx: SendTimeContext = {
          orgTimezone: orgMeta.orgTimezone || 'UTC',
          contactTimezone:
            typeof contact.timezone === 'string' && contact.timezone.trim()
              ? contact.timezone.trim()
              : undefined,
          preferredHourLocal: orgMeta.preferredHourLocal,
          preferredDaysOfWeek: orgMeta.preferredDaysOfWeek,
        }
        const tunedNext = pickSendTime(baseNext, sendCtx)

        await adminDb.collection('sequence_enrollments').doc(enrollDoc.id).update({
          currentStep: nextStepNumber,
          nextSendAt: Timestamp.fromDate(tunedNext),
          pendingBranchEvalAt: null,
          visitedSteps: [...visited, nextStepNumber],
          path: appendPath(enrollment.path, {
            stepNumber: enrollment.currentStep,
            branchTaken: {
              matchedRuleIndex,
              condition: matchedCondition,
              nextStepNumber,
            },
            at: now,
          }),
          updatedAt: FieldValue.serverTimestamp(),
        })
        processed++
        continue
      }

      // ── Normal step-send phase ─────────────────────────────────────────
      const step = steps[enrollment.currentStep]
      if (!step) continue

      // Goal check BEFORE sending.
      const evalCtx: EvaluationContext = {
        orgId: enrollmentOrgId,
        contact,
        sequenceId: enrollment.sequenceId,
        stepNumber: enrollment.currentStep,
        enrolledAt: enrollment.enrolledAt ?? null,
        now: nowDate,
        goals,
      }
      const preHit = await findHitGoal(goals, evalCtx)
      if (preHit) {
        await exitWithGoal(enrollDoc.id, enrollmentOrgId, contact.id, preHit, enrollment.path)
        continue
      }

      // Wait-until gate.
      if (step.waitUntil) {
        let conditionMet = false
        try {
          conditionMet = await evaluateCondition(step.waitUntil.condition, evalCtx)
        } catch (err) {
          console.error('[cron/sequences] waitUntil eval failed', err)
        }

        if (!conditionMet) {
          const waitingSinceMs =
            enrollment.waitingSince && typeof enrollment.waitingSince.toMillis === 'function'
              ? enrollment.waitingSince.toMillis()
              : null
          const startedAtMs = waitingSinceMs ?? nowDate.getTime()
          const maxMs = step.waitUntil.maxWaitDays * DAY_MS
          const expired = nowDate.getTime() - startedAtMs >= maxMs

          if (expired) {
            if (step.waitUntil.onTimeout === 'exit') {
              await adminDb.collection('sequence_enrollments').doc(enrollDoc.id).update({
                status: 'exited',
                exitReason: 'wait-timeout',
                waitingSince: null,
                updatedAt: FieldValue.serverTimestamp(),
              })
              continue
            }
            // onTimeout === 'send' → fall through to the send block below
            // but first clear the waitingSince marker.
            await adminDb.collection('sequence_enrollments').doc(enrollDoc.id).update({
              waitingSince: null,
              updatedAt: FieldValue.serverTimestamp(),
            })
            // proceed to send
          } else {
            // Push nextSendAt forward by 1 hour and keep waiting.
            const update: Record<string, unknown> = {
              nextSendAt: Timestamp.fromDate(new Date(nowDate.getTime() + HOUR_MS)),
              updatedAt: FieldValue.serverTimestamp(),
            }
            if (waitingSinceMs === null) update.waitingSince = now
            await adminDb.collection('sequence_enrollments').doc(enrollDoc.id).update(update)
            continue
          }
        } else if (enrollment.waitingSince) {
          // Condition now satisfied — clear marker before sending.
          await adminDb.collection('sequence_enrollments').doc(enrollDoc.id).update({
            waitingSince: null,
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
      }

      // Look up the org for fallback display name + timezone + send-time settings
      const orgMeta = await loadOrgMeta(enrollmentOrgId)
      const orgName = orgMeta.orgName
      const orgTimezone = orgMeta.orgTimezone
      const preferredHourLocal = orgMeta.preferredHourLocal
      const preferredDaysOfWeek = orgMeta.preferredDaysOfWeek

      const quietHoursDecision = evaluateQuietHours({
        nowUtc: nowDate,
        orgTimezone: orgTimezone || 'UTC',
        contactTimezone:
          typeof contact.timezone === 'string' && contact.timezone.trim()
            ? contact.timezone.trim()
            : undefined,
        quietHours: seq.quietHours,
      })
      if (!quietHoursDecision.allowed) {
        const nextAllowedAt = quietHoursDecision.nextAllowedAt ?? new Date(nowDate.getTime() + DAY_MS)
        await enrollDoc.ref.update({
          nextSendAt: Timestamp.fromDate(nextAllowedAt),
          lastScheduleDecision: {
            reason: 'quiet-hours',
            timezone: quietHoursDecision.timezone,
            evaluatedAt: now,
            nextAllowedAt: Timestamp.fromDate(nextAllowedAt),
          },
          updatedAt: FieldValue.serverTimestamp(),
        })
        continue
      }

      // Look up the campaign if linked. Honor pause / completed / deleted states.
      type CampaignLite = {
        orgId?: string
        senderPolicyId?: string
        fromDomainId?: string
        fromName?: string
        fromLocal?: string
        replyTo?: string
        createdBy?: string
        stats?: { enrolled?: number }
        status?: string
        deleted?: boolean
      }
      const campaignId: string = enrollment.campaignId ?? ''
      let campaign: CampaignLite | null = null

      if (campaignId) {
        const campSnap = await adminDb.collection('campaigns').doc(campaignId).get()
        if (campSnap.exists) {
          campaign = (campSnap.data() ?? null) as CampaignLite | null
          if (campaign?.orgId !== enrollmentOrgId) throw new Error('Campaign organisation mismatch')
          if (campaign?.deleted || campaign?.status === 'completed') {
            await adminDb.collection('sequence_enrollments').doc(enrollDoc.id).update({
              status: 'exited',
              exitReason: 'manual',
              updatedAt: FieldValue.serverTimestamp(),
            })
            continue
          }
          if (campaign?.status === 'paused') {
            await enrollDoc.ref.update({
              nextSendAt: Timestamp.fromMillis(nowDate.getTime() + HOUR_MS),
              updatedAt: FieldValue.serverTimestamp(),
            })
            continue
          }
        }
      }

      // Preferences gate + frequency cap — SINGLE SOURCE OF TRUTH for "can
      // we send to this contact". Honours per-topic opt-outs, hard
      // unsubscribes, frequency='none'. We keep the enrollment alive so a
      // contact who later re-opts-in resumes from where they left off — only
      // the legacy bounced/unsubscribed paths above forcibly exit it.
      const stepWithTopic = step as SequenceStep & { topicId?: string }
      const sequenceTopicId =
        (typeof seq.topicId === 'string' && seq.topicId.trim()) ||
        (typeof stepWithTopic.topicId === 'string' && stepWithTopic.topicId.trim()) ||
        'newsletter'
      if (enrollmentOrgId) {
        const prefsCheck = await shouldSendToContact({
          contactId: enrollment.contactId,
          orgId: enrollmentOrgId,
          topicId: sequenceTopicId,
        })
        if (!prefsCheck.allowed) {
          // Keep the enrollment resumable without hot-looping every cron tick.
          await enrollDoc.ref.update({
            nextSendAt: Timestamp.fromMillis(nowDate.getTime() + DAY_MS),
            updatedAt: FieldValue.serverTimestamp(),
          })
          continue
        }
        const freqCheck = await isWithinFrequencyCap(
          enrollmentOrgId,
          enrollment.contactId,
          sequenceTopicId,
        )
        if (!freqCheck.allowed) {
          await logFrequencySkip({
            orgId: enrollmentOrgId,
            contactId: enrollment.contactId,
            topicId: sequenceTopicId,
            source: 'sequence',
            sourceId: enrollment.sequenceId,
            reason: freqCheck.reason ?? 'frequency cap',
          })
          await enrollDoc.ref.update({
            nextSendAt: Timestamp.fromMillis(nowDate.getTime() + 6 * HOUR_MS),
            updatedAt: FieldValue.serverTimestamp(),
          })
          continue
        }
      }

      // Build template variables (shared across channels).
      const unsubscribeUrl = `${BASE_URL}/api/unsubscribe?token=${signUnsubscribeToken(enrollment.contactId, campaignId || undefined)}`
      const preferencesUrl = `${BASE_URL}/preferences/${encodeURIComponent(signUnsubscribeToken(enrollment.contactId))}`
      const vars = {
        ...varsFromContact(contact),
        orgName,
        unsubscribeUrl,
        preferencesUrl,
      }

      // A/B variant pick — applies whether channel is email or sms. Defer
      // behaviour (winner-only cohort) is shared too.
      const stepAb = (step.ab as AbConfig | undefined) ?? null
      const variantPick = pickVariantForSend({
        contactId: enrollment.contactId,
        subjectId: `${enrollment.sequenceId}:${enrollment.currentStep}`,
        ab: stepAb,
      })
      if (variantPick.defer) {
        await enrollDoc.ref.update({
          nextSendAt: Timestamp.fromMillis(nowDate.getTime() + HOUR_MS),
          updatedAt: FieldValue.serverTimestamp(),
        })
        continue
      }

      // ── Channel dispatch ───────────────────────────────────────────────
      // SMS path: render smsBody with interpolate, call sendSmsToContact,
      // skip the email-specific render + emails-doc write entirely. Email
      // path falls through to the original block below.
      const stepChannel: 'email' | 'sms' =
        (step as SequenceStep & { channel?: 'email' | 'sms' }).channel ?? 'email'

      if (stepChannel === 'sms') {
        const stepSmsBody =
          (step as SequenceStep & { smsBody?: string }).smsBody ??
          step.bodyText ??
          ''
        const interpolatedSmsBody = interpolate(stepSmsBody, vars)
        // A/B variant body override applies to SMS too — reuse the same
        // applyVariantOverrides plumbing to derive an "effective" bodyText.
        const smsEffective = applyVariantOverrides(
          {
            subject: '',
            bodyHtml: '',
            bodyText: interpolatedSmsBody,
            fromName: '',
            scheduledFor: null,
          },
          variantPick.variant,
        )

        const outcome = await sendSmsToContact({
          orgId: enrollmentOrgId,
          contactId: enrollment.contactId,
          body: smsEffective.bodyText,
          topicId: sequenceTopicId,
          sequenceId: enrollment.sequenceId,
          sequenceStep: enrollment.currentStep,
          campaignId: campaignId || undefined,
          variantId: variantPick.variant?.id ?? '',
        })

        if (outcome.status !== 'sent') {
          const failure = deliveryFailureState({
            attemptsBefore: Number(enrollment.deliveryAttempts ?? 0),
            error: outcome.reason ?? `SMS dispatch ${outcome.status}`,
            stepNumber: enrollment.currentStep,
            channel: 'sms',
            nowMs: nowDate.getTime(),
          })
          await enrollDoc.ref.update(deliveryFailureUpdate(failure))
          continue
        }

        if (enrollment.deliveryAttempts || enrollment.lastDeliveryError || enrollment.deadLetter) {
          await enrollDoc.ref.update({
            deliveryAttempts: 0,
            lastDeliveryError: FieldValue.delete(),
            deadLetter: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          })
        }

        // Variant-level sent-stat increment (best-effort).
        if (outcome.status === 'sent' && variantPick.variant?.id) {
          try {
            await incrementVariantStat({
              targetCollection: 'sequences',
              targetId: enrollment.sequenceId,
              stepNumber: enrollment.currentStep,
              variantId: variantPick.variant.id,
              field: 'sent',
            })
          } catch (err) {
            console.error('[cron/sequences] variant stat increment failed (sms)', err)
          }
        }

        // Bump campaign stats on success.
        if (outcome.status === 'sent' && campaignId) {
          await adminDb.collection('campaigns').doc(campaignId).update({
            'stats.sent': FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          })
        }

        // Fall through to the shared post-send progression block below.
      } else {
        // ── Email path ───────────────────────────────────────────────────
        const senderPolicyId =
          (typeof enrollment.senderPolicyId === 'string' && enrollment.senderPolicyId.trim()) ||
          campaign?.senderPolicyId?.trim() ||
          ''
        const senderPolicy = senderPolicyId
          ? await getSenderPolicy(enrollmentOrgId, senderPolicyId)
          : null
        if (senderPolicyId && (!senderPolicy?.enabled || !['lifecycle', 'sales_1to1'].includes(senderPolicy.purpose))) {
          await enrollDoc.ref.update({
            status: 'exited',
            exitReason: 'sender-unavailable',
            lastDeliveryError: 'Sender policy is unavailable, disabled, or invalid for sequences',
            nextSendAt: null,
            updatedAt: FieldValue.serverTimestamp(),
          })
          continue
        }
        const senderResolution = senderPolicy
          ? await resolveSenderForRecipient({
              orgId: enrollmentOrgId,
              actorUid: campaign?.createdBy ?? 'system',
              campaignCreatorUid: campaign?.createdBy ?? null,
              policy: senderPolicy,
              recipient: await buildSenderRecipientContext(enrollmentOrgId, contact, senderPolicy),
              batchSize: Math.max(1, campaign?.stats?.enrolled ?? 1),
            })
          : null
        if (senderResolution && senderResolution.status !== 'resolved') {
          await enrollDoc.ref.update({
            status: 'exited',
            exitReason: 'sender-unavailable',
            lastDeliveryError: senderResolution.reason ?? 'Sender resolution failed',
            nextSendAt: null,
            updatedAt: FieldValue.serverTimestamp(),
          })
          continue
        }
        const policyIdentity = senderResolution?.identity
        const resolved = policyIdentity
          ? {
              from: `${policyIdentity.displayName} <${policyIdentity.emailAddress}>`,
              fromDomainId: policyIdentity.domainId ?? '',
              fromDomain: policyIdentity.emailAddress.split('@')[1] ?? '',
              isFallback: senderResolution?.resolutionSource === 'fallback',
            }
          : await resolveFrom({
              fromDomainId: campaign?.fromDomainId,
              fromName: campaign?.fromName,
              fromLocal: campaign?.fromLocal || 'campaigns',
              orgName,
            })

        const interpolatedSubject = interpolate(step.subject ?? '', vars)
        const interpolatedHtml = interpolate(step.bodyHtml ?? '', vars)
        const interpolatedText = interpolate(step.bodyText ?? '', vars)

        const effective = applyVariantOverrides(
          {
            subject: interpolatedSubject,
            bodyHtml: interpolatedHtml,
            bodyText: interpolatedText,
            fromName: campaign?.fromName ?? '',
            scheduledFor: null,
          },
          variantPick.variant,
        )

        const consent = await resolveCanonicalEmailConsent({
          orgId: enrollmentOrgId,
          contactId: enrollment.contactId,
          email: contact.email,
          topicId: sequenceTopicId,
          transactional: sequenceTopicId === 'transactional',
        })
        if (!consent.allowed) {
          await enrollDoc.ref.update({
            nextSendAt: Timestamp.fromMillis(nowDate.getTime() + DAY_MS),
            lastDeliveryError: consent.reason ?? 'blocked by consent ledger',
            updatedAt: FieldValue.serverTimestamp(),
          })
          continue
        }

        // Send via Resend
        const sendResult = await sendCampaignEmail({
          from: resolved.from,
          to: contact.email,
          replyTo: policyIdentity?.replyTo || campaign?.replyTo,
          subject: effective.subject,
          html: effective.bodyHtml,
          text: effective.bodyText,
          listUnsubscribeUrl: unsubscribeUrl,
        })

        // Create email doc
        const emailRef = await adminDb.collection('emails').add({
          orgId: enrollmentOrgId,
          campaignId,
          fromDomainId: resolved.fromDomainId,
          senderPolicyId: senderResolution?.policyId ?? '',
          senderIdentityId: policyIdentity?.id ?? '',
          senderOwnerUid: senderResolution?.ownerUid ?? null,
          senderResolutionSource: senderResolution?.resolutionSource ?? 'legacy',
          replyTo: policyIdentity?.replyTo || campaign?.replyTo || '',
          direction: 'outbound',
          contactId: enrollment.contactId,
          resendId: sendResult.resendId,
          provider: sendResult.provider ?? '',
          providerMessageId: sendResult.resendId,
          from: resolved.from,
          to: contact.email,
          cc: [],
          subject: effective.subject,
          bodyHtml: effective.bodyHtml,
          bodyText: effective.bodyText,
          status: sendResult.ok ? 'sent' : 'failed',
          scheduledFor: null,
          sentAt: sendResult.ok ? FieldValue.serverTimestamp() : null,
          openedAt: null,
          clickedAt: null,
          bouncedAt: null,
          sequenceId: enrollment.sequenceId,
          sequenceStep: enrollment.currentStep,
          variantId: variantPick.variant?.id ?? '',
          topicId: sequenceTopicId,
          createdAt: FieldValue.serverTimestamp(),
        })

        if (!sendResult.ok) {
          const failure = deliveryFailureState({
            attemptsBefore: Number(enrollment.deliveryAttempts ?? 0),
            error: sendResult.error ?? 'Email provider rejected the send',
            stepNumber: enrollment.currentStep,
            channel: 'email',
            nowMs: nowDate.getTime(),
          })
          await enrollDoc.ref.update(deliveryFailureUpdate(failure))
          continue
        }

        if (enrollment.deliveryAttempts || enrollment.lastDeliveryError) {
          await enrollDoc.ref.update({
            deliveryAttempts: 0,
            lastDeliveryError: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          })
        }

        // Variant-level sent-stat increment (best-effort).
        if (sendResult.ok && variantPick.variant?.id) {
          try {
            await incrementVariantStat({
              targetCollection: 'sequences',
              targetId: enrollment.sequenceId,
              stepNumber: enrollment.currentStep,
              variantId: variantPick.variant.id,
              field: 'sent',
            })
          } catch (err) {
            console.error('[cron/sequences] variant stat increment failed', err)
          }
        }

        // Log activity
        await adminDb.collection('activities').add({
          orgId: enrollmentOrgId,
          contactId: enrollment.contactId,
          type: 'email_sent',
          summary: `Sequence step ${enrollment.currentStep + 1}: ${interpolatedSubject}`,
          metadata: { emailId: emailRef.id, campaignId, sequenceId: enrollment.sequenceId },
          createdAt: FieldValue.serverTimestamp(),
        })

        // Bump campaign stats on success
        if (sendResult.ok && campaignId) {
          await adminDb.collection('campaigns').doc(campaignId).update({
            'stats.sent': FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
      }

      // ── Post-send progression ─────────────────────────────────────────
      // If the step has a branch, schedule re-evaluation. Otherwise linear.
      if (step.branch && Array.isArray(step.branch.rules) && step.branch.rules.length > 0) {
        const earliestEvalDays =
          step.branch.rules.reduce<number>(
            (min, r) =>
              typeof r.evaluateAfterDays === 'number' && r.evaluateAfterDays >= 0
                ? Math.min(min, r.evaluateAfterDays)
                : min,
            Number.POSITIVE_INFINITY,
          ) === Number.POSITIVE_INFINITY
            ? 1
            : Math.max(
                0,
                step.branch.rules.reduce<number>(
                  (min, r) =>
                    typeof r.evaluateAfterDays === 'number' && r.evaluateAfterDays >= 0
                      ? Math.min(min, r.evaluateAfterDays)
                      : min,
                  Number.POSITIVE_INFINITY,
                ),
              )

        const pendingAt = new Date(nowDate.getTime() + earliestEvalDays * DAY_MS)
        const visited: number[] = Array.isArray(enrollment.visitedSteps)
          ? enrollment.visitedSteps
          : [enrollment.currentStep]
        const visitedNext = visited.includes(enrollment.currentStep)
          ? visited
          : [...visited, enrollment.currentStep]
        await adminDb.collection('sequence_enrollments').doc(enrollDoc.id).update({
          pendingBranchEvalAt: Timestamp.fromDate(pendingAt),
          nextSendAt: Timestamp.fromDate(pendingAt),
          visitedSteps: visitedNext,
          path: appendPath(enrollment.path, {
            stepNumber: enrollment.currentStep,
            sentAt: now,
            at: now,
          }),
          updatedAt: FieldValue.serverTimestamp(),
        })
      } else {
        const nextStepIdx = enrollment.currentStep + 1
        const isLast = nextStepIdx >= steps.length

        if (isLast) {
          await adminDb.collection('sequence_enrollments').doc(enrollDoc.id).update({
            status: 'completed',
            exitReason: 'completed',
            completedAt: FieldValue.serverTimestamp(),
            path: appendPath(enrollment.path, {
              stepNumber: enrollment.currentStep,
              sentAt: now,
              at: now,
            }),
            updatedAt: FieldValue.serverTimestamp(),
          })
        } else {
          const visited: number[] = Array.isArray(enrollment.visitedSteps)
            ? enrollment.visitedSteps
            : [enrollment.currentStep]
          const visitedNext = visited.includes(nextStepIdx)
            ? visited
            : [...visited, nextStepIdx]
          // Cycle guard for linear (rare — only if branch on an earlier step
          // jumped backward into a linear region).
          if (visited.includes(nextStepIdx)) {
            await adminDb.collection('sequence_enrollments').doc(enrollDoc.id).update({
              status: 'exited',
              exitReason: 'cycle-detected',
              updatedAt: FieldValue.serverTimestamp(),
            })
            continue
          }
          const nextDelayMs = steps[nextStepIdx].delayDays * DAY_MS
          const baseNext = new Date(nowDate.getTime() + nextDelayMs)
          const sendCtx: SendTimeContext = {
            orgTimezone: orgTimezone || 'UTC',
            contactTimezone:
              typeof contact.timezone === 'string' && contact.timezone.trim()
                ? contact.timezone.trim()
                : undefined,
            preferredHourLocal,
            preferredDaysOfWeek,
          }
          const tunedNext = pickSendTime(baseNext, sendCtx)
          const nextSendAt = Timestamp.fromDate(tunedNext)
          await adminDb.collection('sequence_enrollments').doc(enrollDoc.id).update({
            currentStep: nextStepIdx,
            nextSendAt,
            visitedSteps: visitedNext,
            path: appendPath(enrollment.path, {
              stepNumber: enrollment.currentStep,
              sentAt: now,
              at: now,
            }),
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
      }

      processed++
    } catch (err) {
      // Log and continue so a single bad enrollment doesn't abort the whole run.
      console.error('[cron/sequences] enrollment failed', enrollDoc.id, err)
    } finally {
      if (leaseAcquired) {
        await releaseEnrollmentLease(enrollDoc.id, leaseToken).catch((err) => {
          console.error('[cron/sequences] lease release failed', enrollDoc.id, err)
        })
      }
    }
  }

  return apiSuccess({ processed })
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function acquireEnrollmentLease(
  enrollmentId: string,
  token: string,
  now: Timestamp,
): Promise<boolean> {
  const ref = adminDb.collection('sequence_enrollments').doc(enrollmentId)
  return adminDb.runTransaction(async (transaction) => {
    const current = await transaction.get(ref)
    if (!current.exists) return false
    const data = current.data() ?? {}
    const nextSendAt = data.nextSendAt
    const leaseUntil = data.processingLeaseUntil
    if (data.status !== 'active') return false
    if (nextSendAt?.toMillis?.() > now.toMillis()) return false
    if (leaseUntil?.toMillis?.() > now.toMillis()) return false
    transaction.update(ref, {
      processingLeaseToken: token,
      processingLeaseUntil: Timestamp.fromMillis(now.toMillis() + LEASE_MS),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return true
  })
}

async function releaseEnrollmentLease(enrollmentId: string, token: string): Promise<void> {
  const ref = adminDb.collection('sequence_enrollments').doc(enrollmentId)
  await adminDb.runTransaction(async (transaction) => {
    const current = await transaction.get(ref)
    if (!current.exists || current.data()?.processingLeaseToken !== token) return
    transaction.update(ref, {
      processingLeaseToken: FieldValue.delete(),
      processingLeaseUntil: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  })
}

interface OrgMeta {
  orgName: string
  orgTimezone: string
  preferredHourLocal: number
  preferredDaysOfWeek: number[]
}

async function loadOrgMeta(orgId: string): Promise<OrgMeta> {
  const meta: OrgMeta = {
    orgName: '',
    orgTimezone: '',
    preferredHourLocal: 9,
    preferredDaysOfWeek: [1, 2, 3, 4, 5],
  }
  if (!orgId) return meta
  const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgSnap.exists) return meta
  const orgData = (orgSnap.data() ?? {}) as {
    name?: string
    settings?: {
      timezone?: string
      preferredSendHourLocal?: number
      preferredSendDaysOfWeek?: number[]
    }
  }
  meta.orgName = orgData.name ?? ''
  meta.orgTimezone = orgData.settings?.timezone ?? ''
  if (
    typeof orgData.settings?.preferredSendHourLocal === 'number' &&
    orgData.settings.preferredSendHourLocal >= 0 &&
    orgData.settings.preferredSendHourLocal <= 23
  ) {
    meta.preferredHourLocal = orgData.settings.preferredSendHourLocal
  }
  if (
    Array.isArray(orgData.settings?.preferredSendDaysOfWeek) &&
    orgData.settings.preferredSendDaysOfWeek.length > 0
  ) {
    meta.preferredDaysOfWeek = orgData.settings.preferredSendDaysOfWeek
  }
  return meta
}

async function exitWithGoal(
  enrollmentId: string,
  orgId: string,
  contactId: string,
  goal: SequenceGoal,
  existingPath: EnrollmentPathEntry[] | undefined,
): Promise<void> {
  const now = Timestamp.now()
  const completion = goalCompletionState(goal)
  await adminDb.collection('sequence_enrollments').doc(enrollmentId).update({
    ...completion,
    completedGoalId: goal.id,
    completedGoalLabel: goal.label,
    completedAt: FieldValue.serverTimestamp(),
    pendingBranchEvalAt: null,
    waitingSince: null,
    path: appendPath(existingPath, {
      stepNumber: -1,
      goalHit: { goalId: goal.id, label: goal.label, outcome: completion.goalOutcome },
      at: now,
    }),
    updatedAt: FieldValue.serverTimestamp(),
  })
  await adminDb.collection('activities').add({
    orgId,
    contactId,
    type: 'sequence_goal_hit',
    summary: `Goal hit: ${goal.label}`,
    metadata: { goalId: goal.id, exitReason: goal.exitReason ?? 'goal-hit', outcome: completion.goalOutcome },
    createdAt: FieldValue.serverTimestamp(),
  })
}

function appendPath(
  existing: EnrollmentPathEntry[] | undefined,
  entry: EnrollmentPathEntry,
): EnrollmentPathEntry[] {
  const prev = Array.isArray(existing) ? existing : []
  return [...prev, entry]
}

function deliveryFailureUpdate(failure: ReturnType<typeof deliveryFailureState>): Record<string, unknown> {
  return {
    status: failure.status,
    exitReason: failure.exitReason ?? FieldValue.delete(),
    deliveryAttempts: failure.deliveryAttempts,
    lastDeliveryError: failure.lastDeliveryError,
    lastDeliveryAttemptAt: Timestamp.fromMillis(failure.lastDeliveryAttemptAtMs),
    nextSendAt: failure.retryAtMs === null ? null : Timestamp.fromMillis(failure.retryAtMs),
    deadLetter: failure.deadLetter
      ? {
          stepNumber: failure.deadLetter.stepNumber,
          attempts: failure.deadLetter.attempts,
          reason: failure.deadLetter.reason,
          channel: failure.deadLetter.channel,
          replayable: failure.deadLetter.replayable,
          failedAt: Timestamp.fromMillis(failure.deadLetter.failedAtMs),
        }
      : FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  }
}
