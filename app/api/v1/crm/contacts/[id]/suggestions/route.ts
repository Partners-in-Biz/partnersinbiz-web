// app/api/v1/crm/contacts/[id]/suggestions/route.ts
//
// GET /api/v1/crm/contacts/[id]/suggestions
// Returns rule-based action suggestions for a contact based on stage,
// lead score, and recent activity history (no LLM required).
// Auth: member+

import { NextRequest } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { apiSuccess, apiError } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { adminDb } from '@/lib/firebase/admin'
import {
  crmActorCanReadRecord,
  crmRecordCompanyIds,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
} from '@/lib/crm/assignment-access'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

interface Suggestion {
  action: string
  reason: string
  urgency: 'high' | 'medium' | 'low'
}

async function loadAccessibleContact(
  ctx: CrmAuthContext,
  contactId: string,
): Promise<{ ok: true; contact: Record<string, unknown> } | { ok: false; res: Response }> {
  const snap = await adminDb.collection('contacts').doc(contactId).get()
  if (!snap.exists) return { ok: false, res: apiError('Contact not found', 404) }
  const data = snap.data()!
  if (data.orgId !== ctx.orgId || data.deleted === true) {
    return { ok: false, res: apiError('Contact not found', 404) }
  }
  if (!isCrmPrivilegedActor(ctx)) {
    const companies = await loadCompanyAssignmentMap(ctx.orgId, crmRecordCompanyIds(data))
    if (!crmActorCanReadRecord(ctx, { id: snap.id, ...data }, { companies })) {
      return { ok: false, res: apiError('Contact not found', 404) }
    }
  }
  return { ok: true, contact: { id: snap.id, ...data } }
}

async function handler(
  _req: NextRequest,
  ctx: CrmAuthContext,
  routeCtx?: RouteCtx,
): Promise<Response> {
  const { id: contactId } = await routeCtx!.params

  if (!contactId) return apiError('Contact ID is required', 400)

  // ── Fetch contact + enforce owned/linked access ────────────────────────────
  const access = await loadAccessibleContact(ctx, contactId)
  if (!access.ok) return access.res

  const contact = access.contact as {
    orgId?: string
    stage?: string
    leadScore?: number
    [key: string]: unknown
  }

  // ── Fetch last 5 activities ──────────────────────────────────────────────────
  const activitiesSnap = await adminDb
    .collection('activities')
    .where('contactId', '==', contactId)
    .orderBy('createdAt', 'desc')
    .limit(5)
    .get()

  // ── Compute days since last activity ────────────────────────────────────────
  let daysSinceLastActivity = 999

  if (!activitiesSnap.empty) {
    const latest = activitiesSnap.docs[0].data()
    const createdAt = latest.createdAt as Timestamp | null
    if (createdAt) {
      const msAgo = Date.now() - createdAt.toMillis()
      daysSinceLastActivity = Math.floor(msAgo / 86_400_000)
    }
  }

  // ── Apply rules ──────────────────────────────────────────────────────────────
  const suggestions: Suggestion[] = []

  if (daysSinceLastActivity >= 7 && contact.stage === 'contacted') {
    suggestions.push({
      action: 'Send a follow-up',
      reason: 'No activity in 7+ days',
      urgency: 'high',
    })
  }

  if ((contact.leadScore ?? 50) < 30) {
    suggestions.push({
      action: 'Qualify or archive',
      reason: 'Low lead score',
      urgency: 'medium',
    })
  }

  if (contact.stage === 'proposal' && daysSinceLastActivity >= 3) {
    suggestions.push({
      action: 'Chase the proposal',
      reason: 'Proposal sent 3+ days ago',
      urgency: 'high',
    })
  }

  if ((contact.leadScore ?? 0) > 70 && contact.stage === 'replied') {
    suggestions.push({
      action: 'Move to demo',
      reason: 'High lead score + replied',
      urgency: 'medium',
    })
  }

  if (contact.stage === 'demo') {
    suggestions.push({
      action: 'Send a proposal',
      reason: 'Contact in demo stage',
      urgency: 'low',
    })
  }

  return apiSuccess({ suggestions })
}

export const GET = withCrmAuth<RouteCtx>('member', handler)
