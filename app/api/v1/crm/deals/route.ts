/**
 * GET  /api/v1/crm/deals  — list deals
 * POST /api/v1/crm/deals  — create deal
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { resolveMemberRef, type MemberRef } from '@/lib/orgMembers/memberRef'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { Deal, DealStage, Currency, Contact } from '@/lib/crm/types'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { logActivity } from '@/lib/activity/log'
import { loadCompany } from '@/lib/companies/store'

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

const VALID_STAGES: DealStage[] = ['discovery', 'proposal', 'negotiation', 'won', 'lost']
const VALID_CURRENCIES: Currency[] = ['USD', 'EUR', 'ZAR']

export const GET = withCrmAuth('viewer', async (req, ctx) => {
  const { searchParams } = new URL(req.url)
  const { orgId } = ctx
  const stage = searchParams.get('stage') as DealStage | null
  const contactId = searchParams.get('contactId')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 500)
  const page = Math.max(parseInt(searchParams.get('page') ?? '1'), 1)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = adminDb.collection('deals').orderBy('createdAt', 'desc')
  if (orgId) query = query.where('orgId', '==', orgId)
  if (stage && VALID_STAGES.includes(stage)) query = query.where('stage', '==', stage)
  if (contactId) query = query.where('contactId', '==', contactId)

  const snapshot = await query
    .limit(limit)
    .offset((page - 1) * limit)
    .get()

  const deals: Deal[] = snapshot.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((doc: any) => ({ id: doc.id, ...doc.data() }))
    .filter((d: Deal) => d.deleted !== true)
  return apiSuccess(deals, 200, { total: deals.length, page, limit })
})

export const POST = withCrmAuth('member', async (req, ctx) => {
  const body = await req.json()

  // Validation
  if (!body.title?.trim()) return apiError('Title is required', 400)
  if (!body.contactId?.trim()) return apiError('contactId is required', 400)
  const stage = body.stage ?? 'discovery'
  if (!VALID_STAGES.includes(stage)) return apiError('Invalid stage', 400)
  const currency = body.currency ?? 'ZAR'
  if (!VALID_CURRENCIES.includes(currency)) return apiError('Invalid currency — use USD, EUR, or ZAR', 400)

  // PR 3 pattern 1: use ctx.actor directly (no snapshotForWrite)
  const actorRef: MemberRef = ctx.actor

  // PR 3 pattern 3: ownerRef on POST when ownerUid present
  let ownerRef: MemberRef | undefined
  if (typeof body.ownerUid === 'string' && body.ownerUid !== '') {
    ownerRef = await resolveMemberRef(ctx.orgId, body.ownerUid)
  }

  const dealData: Record<string, unknown> = {
    orgId: ctx.orgId,
    contactId: body.contactId.trim(),
    title: body.title.trim(),
    value: typeof body.value === 'number' ? body.value : 0,
    currency,
    stage,
    expectedCloseDate: body.expectedCloseDate ?? null,
    notes: typeof body.notes === 'string' ? body.notes.trim() : '',
    deleted: false,
    ownerUid: typeof body.ownerUid === 'string' && body.ownerUid !== '' ? body.ownerUid : undefined,
    ownerRef,
    createdBy: ctx.isAgent ? undefined : ctx.actor.uid,
    createdByRef: actorRef,
    updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
    updatedByRef: actorRef,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  // Auto-derive companyId from contact when not explicitly provided
  if (body.contactId && !body.companyId) {
    const derived = await deriveCompanyFromContact(body.contactId, ctx.orgId)
    Object.assign(dealData, derived)
  }
  // Explicit companyId in body always wins — validate and use it
  if (body.companyId) {
    const loaded = await loadCompany(body.companyId, ctx.orgId)
    if (!loaded) return apiError('Invalid companyId', 400)
    dealData.companyId = body.companyId
    dealData.companyName = loaded.data.name
  }

  // Firestore rejects undefined values — strip them before write
  const sanitized = Object.fromEntries(Object.entries(dealData).filter(([, v]) => v !== undefined))

  const docRef = adminDb.collection('deals').doc()
  await docRef.set(sanitized)

  // PR 3 pattern 2: explicit-field webhook payload (no body spread)
  try {
    await dispatchWebhook(ctx.orgId, 'deal.created', {
      id: docRef.id,
      title: dealData.title,
      value: dealData.value,
      stage: dealData.stage,
      contactId: dealData.contactId,
      createdByRef: actorRef,
      ownerRef,
    })
  } catch (err) {
    console.error('[webhook-dispatch-error] deal.created', err)
  }

  logActivity({
    orgId: ctx.orgId,
    type: 'crm_deal_created',
    actorId: ctx.actor.uid,
    actorName: ctx.actor.displayName,
    actorRole: ctx.isAgent ? 'ai' : ctx.role === 'admin' ? 'admin' : 'client',
    description: `Created deal: "${dealData.title}"`,
    entityId: docRef.id,
    entityType: 'deal',
    entityTitle: dealData.title,
  }).catch(() => {})

  return apiSuccess({ id: docRef.id }, 201)
})
