/**
 * PUT    /api/v1/crm/deals/:id  — update deal (member+)
 * PATCH  /api/v1/crm/deals/:id  — alias for PUT
 * DELETE /api/v1/crm/deals/:id  — soft delete (admin+)
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { resolveMemberRef, type MemberRef } from '@/lib/orgMembers/memberRef'
import { apiSuccess, apiError } from '@/lib/api/response'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { logActivity } from '@/lib/activity/log'
import { tryAttributeDealWon } from '@/lib/email-analytics/attribution-hooks'
import { loadCompany } from '@/lib/companies/store'
import type { Contact } from '@/lib/crm/types'

async function deriveCompanyFromContact(contactId: string, orgId: string): Promise<{ companyId?: string; companyName?: string }> {
  try {
    const snap = await adminDb.collection('contacts').doc(contactId).get()
    if (!snap.exists) return {}
    const c = snap.data() as Contact
    if (c.orgId !== orgId) return {}  // cross-tenant safeguard
    if (!c.companyId) return {}
    return { companyId: c.companyId, companyName: c.companyName }
  } catch (e) {
    console.error('deriveCompanyFromContact failed', e)
    return {}
  }
}

type RouteCtx = { params: Promise<{ id: string }> }

// ---------------------------------------------------------------------------
// PUT/PATCH — member+
// ---------------------------------------------------------------------------

async function handleDealUpdate(
  req: NextRequest,
  ctx: CrmAuthContext,
  routeCtx: RouteCtx | undefined,
): Promise<Response> {
  const { id } = await routeCtx!.params
  const ref = adminDb.collection('deals').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Deal not found', 404)
  const before = snap.data()!
  if (before.orgId !== ctx.orgId) return apiError('Deal not found', 404)

  const body = await req.json()

  // PR 3 pattern 1: use ctx.actor directly (no snapshotForWrite)
  const actorRef: MemberRef = ctx.actor

  // PR 3 pattern 3: ownerRef resolution when ownerUid changes
  let ownerRef: MemberRef | undefined
  const newOwnerUid = typeof body.ownerUid === 'string' ? body.ownerUid : undefined
  const ownerChanged = newOwnerUid !== undefined && newOwnerUid !== (before.ownerUid ?? '')

  const patch: Record<string, unknown> = {
    ...body,
    updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
    updatedByRef: actorRef,
    updatedAt: FieldValue.serverTimestamp(),
  }

  if (ownerChanged) {
    if (newOwnerUid !== '') {
      ownerRef = await resolveMemberRef(ctx.orgId, newOwnerUid)
      patch.ownerRef = ownerRef
    } else {
      // Unassign — explicitly clear ownerRef in Firestore
      patch.ownerRef = FieldValue.delete()
    }
  }

  // contactId changed AND user didn't explicitly set companyId — auto-repopulate
  if (body.contactId && body.contactId !== before.contactId && !('companyId' in body)) {
    const derived = await deriveCompanyFromContact(body.contactId, ctx.orgId)
    if (derived.companyId !== undefined) patch.companyId = derived.companyId
    if (derived.companyName !== undefined) patch.companyName = derived.companyName
  }

  // Explicit companyId in body always wins
  if ('companyId' in body) {
    if (body.companyId === '' || body.companyId === null) {
      patch.companyId = FieldValue.delete()
      patch.companyName = FieldValue.delete()
    } else {
      const loaded2 = await loadCompany(body.companyId as string, ctx.orgId)
      if (!loaded2) return apiError('Invalid companyId', 400)
      patch.companyId = body.companyId
      patch.companyName = loaded2.data.name
    }
  }

  // Firestore rejects undefined values — strip them before write
  const sanitized = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  await ref.update(sanitized)

  const fromStage = before.stage
  const toStage = typeof body.stage === 'string' ? body.stage : undefined
  const stageChanged = toStage !== undefined && toStage !== fromStage
  const dealValue = typeof body.value === 'number' ? body.value : before.value
  const dealTitle = typeof before.title === 'string' ? before.title : (id as string)
  const actorRole = ctx.isAgent ? 'ai' : ctx.role === 'admin' ? 'admin' : 'client'

  if (stageChanged) {
    // PR 3 pattern 2: explicit-field webhook payload (no body spread)
    try {
      await dispatchWebhook(ctx.orgId, 'deal.stage_changed', {
        id,
        fromStage,
        toStage,
        value: dealValue,
        updatedByRef: actorRef,
        ownerRef: ownerRef ?? before.ownerRef,
      })
    } catch (e) {
      console.error('[webhook-dispatch-error] deal.stage_changed', e)
    }

    // Resolve contactId for activities timeline writes (best-effort only)
    const contactId =
      (typeof body?.contactId === 'string' && body.contactId) ||
      (typeof before.contactId === 'string' && before.contactId) ||
      null

    // Stage-change activity — appears on contact timeline regardless of sub-stage
    if (contactId) {
      try {
        const activityData = Object.fromEntries(Object.entries({
          orgId: ctx.orgId,
          contactId,
          dealId: id,
          type: 'stage_change',
          summary: `Deal moved: ${fromStage} → ${toStage}`,
          metadata: { fromStage, toStage, dealTitle },
          createdBy: ctx.isAgent ? undefined : ctx.actor.uid,
          createdByRef: actorRef,
          createdAt: FieldValue.serverTimestamp(),
        }).filter(([, v]) => v !== undefined))
        await adminDb.collection('activities').add(activityData)
      } catch (e) {
        console.error('[activities] timeline write failed (stage_change)', e)
      }
    }

    if (toStage === 'won') {
      try {
        await dispatchWebhook(ctx.orgId, 'deal.won', {
          id,
          title: dealTitle,
          value: dealValue,
          updatedByRef: actorRef,
        })
      } catch (e) {
        console.error('[webhook-dispatch-error] deal.won', e)
      }

      const currency =
        (typeof body?.currency === 'string' && body.currency) ||
        (typeof before.currency === 'string' && before.currency) ||
        'ZAR'
      try {
        await tryAttributeDealWon({
          orgId: ctx.orgId,
          contactId,
          dealId: id,
          amount: typeof dealValue === 'number' ? dealValue : 0,
          currency,
        })
      } catch (e) {
        console.error('[attribution-error] tryAttributeDealWon', e)
      }

      try {
        await logActivity({
          orgId: ctx.orgId,
          type: 'crm_deal_won',
          actorId: ctx.actor.uid,
          actorName: ctx.actor.displayName,
          actorRole,
          entityId: id,
          entityType: 'deal',
          entityTitle: dealTitle,
          description: `Deal won: ${dealTitle}`,
        })
      } catch (e) {
        console.error('[activity-log-error] crm_deal_won', e)
      }

      // Deal won — additional timeline note with value
      if (contactId) {
        try {
          const currency =
            (typeof body?.currency === 'string' && body.currency) ||
            (typeof before.currency === 'string' && before.currency) ||
            'ZAR'
          const activityData = Object.fromEntries(Object.entries({
            orgId: ctx.orgId,
            contactId,
            dealId: id,
            type: 'note',
            summary: `Deal won: ${dealTitle} (${currency} ${dealValue})`,
            metadata: { dealTitle, value: dealValue, currency },
            createdBy: ctx.isAgent ? undefined : ctx.actor.uid,
            createdByRef: actorRef,
            createdAt: FieldValue.serverTimestamp(),
          }).filter(([, v]) => v !== undefined))
          await adminDb.collection('activities').add(activityData)
        } catch (e) {
          console.error('[activities] timeline write failed (deal.won)', e)
        }
      }
    } else if (toStage === 'lost') {
      try {
        await dispatchWebhook(ctx.orgId, 'deal.lost', {
          id,
          title: dealTitle,
          value: dealValue,
          updatedByRef: actorRef,
        })
      } catch (e) {
        console.error('[webhook-dispatch-error] deal.lost', e)
      }

      try {
        await logActivity({
          orgId: ctx.orgId,
          type: 'crm_deal_lost',
          actorId: ctx.actor.uid,
          actorName: ctx.actor.displayName,
          actorRole,
          entityId: id,
          entityType: 'deal',
          entityTitle: dealTitle,
          description: `Deal lost: ${dealTitle}`,
        })
      } catch (e) {
        console.error('[activity-log-error] crm_deal_lost', e)
      }

      // Deal lost — additional timeline note
      if (contactId) {
        try {
          const activityData = Object.fromEntries(Object.entries({
            orgId: ctx.orgId,
            contactId,
            dealId: id,
            type: 'note',
            summary: `Deal lost: ${dealTitle}`,
            metadata: { dealTitle },
            createdBy: ctx.isAgent ? undefined : ctx.actor.uid,
            createdByRef: actorRef,
            createdAt: FieldValue.serverTimestamp(),
          }).filter(([, v]) => v !== undefined))
          await adminDb.collection('activities').add(activityData)
        } catch (e) {
          console.error('[activities] timeline write failed (deal.lost)', e)
        }
      }
    } else {
      try {
        await logActivity({
          orgId: ctx.orgId,
          type: 'crm_deal_updated',
          actorId: ctx.actor.uid,
          actorName: ctx.actor.displayName,
          actorRole,
          entityId: id,
          entityType: 'deal',
          entityTitle: dealTitle,
          description: `Updated deal ${dealTitle}`,
        })
      } catch (e) {
        console.error('[activity-log-error] crm_deal_updated', e)
      }
    }
  } else {
    try {
      await logActivity({
        orgId: ctx.orgId,
        type: 'crm_deal_updated',
        actorId: ctx.actor.uid,
        actorName: ctx.actor.displayName,
        actorRole,
        entityId: id,
        entityType: 'deal',
        entityTitle: dealTitle,
        description: `Updated deal ${dealTitle}`,
      })
    } catch (e) {
      console.error('[activity-log-error] crm_deal_updated', e)
    }
  }

  return apiSuccess({ deal: { id, ...before, ...sanitized } })
}

export const PUT = withCrmAuth<RouteCtx>('member', handleDealUpdate)
export const PATCH = withCrmAuth<RouteCtx>('member', handleDealUpdate)

// ---------------------------------------------------------------------------
// DELETE — admin+
// ---------------------------------------------------------------------------

export const DELETE = withCrmAuth<RouteCtx>('admin', async (_req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const ref = adminDb.collection('deals').doc(id)
  const snap = await ref.get()
  if (!snap.exists) return apiError('Deal not found', 404)
  const data = snap.data()!
  if (data.orgId !== ctx.orgId) return apiError('Deal not found', 404)

  // PR 3 pattern 1: use ctx.actor directly
  const actorRef: MemberRef = ctx.actor
  const actorRole = ctx.isAgent ? 'ai' : ctx.role === 'admin' ? 'admin' : 'client'

  const deletePatch: Record<string, unknown> = {
    deleted: true,
    updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
    updatedByRef: actorRef,
    updatedAt: FieldValue.serverTimestamp(),
  }
  const sanitized = Object.fromEntries(Object.entries(deletePatch).filter(([, v]) => v !== undefined))
  await ref.update(sanitized)

  try {
    await logActivity({
      orgId: ctx.orgId,
      type: 'crm_deal_deleted',
      actorId: ctx.actor.uid,
      actorName: ctx.actor.displayName,
      actorRole,
      entityId: id,
      entityType: 'deal',
      entityTitle: data.title,
      description: `Deleted deal ${data.title}`,
    })
  } catch (e) {
    console.error('[activity-log-error] crm_deal_deleted', e)
  }

  return apiSuccess({ id })
})
