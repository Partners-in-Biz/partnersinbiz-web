/**
 * POST /api/v1/admin/moderation/[contentId]
 *
 * Records a moderation decision against a piece of flagged content and applies
 * the side effects:
 *  - approve  → underlying social_post/campaign status set to 'approved'
 *  - remove   → status set to 'rejected'/'removed'; org strike count incremented,
 *               warning appended; auto-suspend at >= 3 strikes
 *  - escalate → status set to 'escalated'; no strike
 *
 * `reason` is required for remove + escalate. Every decision is written to the
 * `moderation_decisions` collection and a `moderation.${decision}` admin audit
 * entry is recorded. Auth: admin.
 */

import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { writeAdminAudit } from '@/lib/admin/audit'
import { canAccessOrg } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

const STRIKE_LIMIT = 3

type DecisionVerb = 'approve' | 'remove' | 'escalate'
type DecisionResult = 'approved' | 'removed' | 'escalated'

const VERB_TO_RESULT: Record<DecisionVerb, DecisionResult> = {
  approve: 'approved',
  remove: 'removed',
  escalate: 'escalated',
}

/** New status applied to the underlying content document. */
const VERB_TO_STATUS: Record<DecisionVerb, string> = {
  approve: 'approved',
  remove: 'rejected',
  escalate: 'escalated',
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const url = new URL(req.url)
  const contentId = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '')
  if (!contentId) return apiError('Missing contentId', 400)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const contentType = String(body.contentType ?? '')
  if (contentType !== 'social_post' && contentType !== 'campaign') {
    return apiError("contentType must be 'social_post' or 'campaign'", 400)
  }

  const orgId = String(body.orgId ?? '').trim()
  if (!orgId) return apiError('orgId is required', 400)

  // A restricted admin may only moderate orgs they are scoped to. Without this,
  // a body-supplied orgId lets them strike / auto-suspend any organisation.
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)

  const decision = String(body.decision ?? '') as DecisionVerb
  if (!['approve', 'remove', 'escalate'].includes(decision)) {
    return apiError("decision must be 'approve', 'remove', or 'escalate'", 400)
  }

  const reason = String(body.reason ?? '').trim()
  if ((decision === 'remove' || decision === 'escalate') && !reason) {
    return apiError(`A reason is required to ${decision} content`, 400)
  }

  const collectionName = contentType === 'social_post' ? 'social_posts' : 'campaigns'
  const contentRef = adminDb.collection(collectionName).doc(contentId)

  // Pull existing confidence off the content doc if present.
  let confidence: number | null = null
  try {
    const snap = await contentRef.get()
    if (snap.exists) {
      const data = snap.data() as Record<string, unknown>
      confidence = asNumber(data.aiConfidence) ?? asNumber(data.moderationConfidence)
    }
  } catch {
    // Non-fatal — confidence simply stays null.
  }

  const result = VERB_TO_RESULT[decision]
  const newStatus = VERB_TO_STATUS[decision]
  const now = FieldValue.serverTimestamp()

  // 1. Update the underlying content status (merge so we never clobber the doc).
  try {
    await contentRef.set(
      {
        status: newStatus,
        moderation: {
          decision: result,
          reason: reason || null,
          decidedBy: user.uid,
          decidedAt: now,
        },
        updatedAt: now,
      },
      { merge: true },
    )
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to update content status', 500)
  }

  // 2. Record the decision.
  await adminDb.collection('moderation_decisions').add({
    contentId,
    contentType,
    orgId,
    decision: result,
    reason: reason || null,
    confidence,
    decidedBy: user.uid,
    decidedAt: now,
  })

  // 3. Strike handling — only on removal.
  let strikeCount = 0
  let suspended = false
  const strikeRef = adminDb.collection('moderation_strikes').doc(orgId)

  if (decision === 'remove') {
    const strikeSnap = await strikeRef.get()
    const existing = strikeSnap.exists ? (strikeSnap.data() as Record<string, unknown>) : {}
    strikeCount = (asNumber(existing.strikes) ?? 0) + 1
    suspended = strikeCount >= STRIKE_LIMIT || existing.suspended === true

    const update: Record<string, unknown> = {
      orgId,
      strikes: strikeCount,
      warnings: FieldValue.arrayUnion({
        reason,
        contentId,
        at: new Date().toISOString(),
      }),
      updatedAt: now,
    }
    if (suspended) {
      update.suspended = true
      if (existing.suspended !== true) update.suspendedAt = now
    }

    await strikeRef.set(update, { merge: true })

    if (suspended && existing.suspended !== true) {
      await writeAdminAudit(user, {
        action: 'moderation.auto_suspend',
        orgId,
        summary: `Org auto-suspended after ${strikeCount} moderation strikes`,
        metadata: { contentId, contentType, strikes: strikeCount, reason },
      })
    }
  } else {
    const strikeSnap = await strikeRef.get()
    if (strikeSnap.exists) {
      const existing = strikeSnap.data() as Record<string, unknown>
      strikeCount = asNumber(existing.strikes) ?? 0
      suspended = existing.suspended === true
    }
  }

  // 4. Audit the decision itself.
  await writeAdminAudit(user, {
    action: `moderation.${decision}`,
    orgId,
    summary: `Moderation ${result} on ${contentType} ${contentId}`,
    metadata: { contentId, contentType, decision: result, reason: reason || null, confidence },
  })

  return apiSuccess({
    decision: {
      contentId,
      contentType,
      orgId,
      decision: result,
      reason: reason || null,
      confidence,
      decidedBy: user.uid,
    },
    strikes: strikeCount,
    suspended,
  })
})
