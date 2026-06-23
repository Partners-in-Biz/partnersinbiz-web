import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { actorFrom } from '@/lib/api/actor'
import type { ChurnEvent } from '@/lib/billing/types'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/admin/billing/churn/[orgId]/winback
 *
 * Trigger a win-back attempt for a churned or at-risk org. If a churn_event
 * exists for the org, mark it as win-back-triggered. Always logs an activity
 * and notifies the platform_owner team so a human follows up.
 */
export const POST = withAuth('admin', async (req, user, ctx) => {
  const params = (await ctx?.params) as { orgId?: string } | undefined
  const orgId = params?.orgId
  if (!orgId) return apiError('Missing orgId', 400)

  let note: string | undefined
  try {
    const body = (await req.json()) as { note?: unknown } | null
    if (body && typeof body.note === 'string' && body.note.trim()) {
      note = body.note.trim()
    }
  } catch {
    // No body / invalid JSON is fine — note is optional.
  }

  // Resolve org name for friendly messaging.
  const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
  const orgName = (orgSnap.data()?.name as string | undefined) ?? orgId

  // Find the most recent churn_events doc for this org (if any).
  const churnSnap = await adminDb
    .collection('churn_events')
    .where('orgId', '==', orgId)
    .get()

  let churnDocId: string | null = null
  if (!churnSnap.empty) {
    const sorted = churnSnap.docs
      .map((d) => {
        const data = d.data() as ChurnEvent
        const ts = data.churnedAt ?? data.createdAt
        const ms =
          ts && typeof (ts as { toMillis?: () => number }).toMillis === 'function'
            ? (ts as { toMillis: () => number }).toMillis()
            : 0
        return { id: d.id, ms, name: data.orgName }
      })
      .sort((a, b) => b.ms - a.ms)
    churnDocId = sorted[0]?.id ?? null
  }

  if (churnDocId) {
    await adminDb.collection('churn_events').doc(churnDocId).update({
      winBackTriggered: true,
      winBackTriggeredAt: FieldValue.serverTimestamp(),
    })
  }

  const summary = `Win-back attempt triggered for ${orgName}${note ? `: ${note}` : ''}`

  // Audit log.
  await adminDb.collection('activities').add({
    orgId,
    type: 'billing.winback_triggered',
    resourceType: 'organization',
    resourceId: orgId,
    summary,
    ...actorFrom(user),
    createdAt: FieldValue.serverTimestamp(),
  })

  // Notify the platform_owner team so a human follows up.
  const ownerSnap = await adminDb
    .collection('organizations')
    .where('type', '==', 'platform_owner')
    .limit(1)
    .get()
  const ownerOrgId = ownerSnap.empty ? null : ownerSnap.docs[0].id

  if (ownerOrgId) {
    await adminDb.collection('notifications').add({
      orgId: ownerOrgId,
      userId: null,
      agentId: null,
      type: 'billing.winback',
      title: 'Win-back follow-up needed',
      body: note
        ? `Win-back triggered for ${orgName}: ${note}`
        : `Win-back triggered for ${orgName}. Reach out to retain this account.`,
      link: '/admin/billing/churn',
      status: 'unread',
      createdAt: FieldValue.serverTimestamp(),
    })
  }

  return apiSuccess({ orgId, winBackTriggered: true })
})
