/**
 * GET  /api/v1/crm/deals  — list deals
 * POST /api/v1/crm/deals  — create deal
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { resolveMemberRef, type MemberRef } from '@/lib/orgMembers/memberRef'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { Deal, Currency, Contact } from '@/lib/crm/types'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { logActivity } from '@/lib/activity/log'
import { loadCompany } from '@/lib/companies/store'
import { getDefinitionsForResource } from '@/lib/customFields/store'
import { validateCustomFields } from '@/lib/customFields/validation'
import { loadPipeline, getDefaultPipelineForOrg } from '@/lib/pipelines/store'

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

const VALID_CURRENCIES: Currency[] = ['USD', 'EUR', 'ZAR']

export const GET = withCrmAuth('viewer', async (req, ctx) => {
  const { searchParams } = new URL(req.url)
  const { orgId } = ctx
  const pipelineId = searchParams.get('pipelineId')
  const stageId = searchParams.get('stageId')
  const contactId = searchParams.get('contactId')
  const search = searchParams.get('search') ?? ''
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 500)
  const page = Math.max(parseInt(searchParams.get('page') ?? '1'), 1)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = adminDb.collection('deals').where('orgId', '==', orgId)

  const snapshot = await query.limit(1000).get()

  let deals: Deal[] = snapshot.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((doc: any) => ({ id: doc.id, ...doc.data() }))
    .filter((d: Deal) => d.deleted !== true)
    .filter((d: Deal) => !pipelineId || d.pipelineId === pipelineId)
    .filter((d: Deal) => !stageId || d.stageId === stageId)
    .filter((d: Deal) => !contactId || d.contactId === contactId)

  if (search) {
    const q = search.toLowerCase()
    deals = deals.filter((d) => d.title?.toLowerCase().includes(q))
  }

  deals = deals.sort((a, b) => {
    const aSeconds = (a.createdAt as { seconds?: number; _seconds?: number } | null | undefined)?.seconds
      ?? (a.createdAt as { seconds?: number; _seconds?: number } | null | undefined)?._seconds
      ?? 0
    const bSeconds = (b.createdAt as { seconds?: number; _seconds?: number } | null | undefined)?.seconds
      ?? (b.createdAt as { seconds?: number; _seconds?: number } | null | undefined)?._seconds
      ?? 0
    return bSeconds - aSeconds
  })

  const total = deals.length
  const start = (page - 1) * limit
  const paged = deals.slice(start, start + limit)

  return apiSuccess(paged, 200, { total, page, limit })
})

export const POST = withCrmAuth('member', async (req, ctx) => {
  const body = await req.json()

  // Validation
  if (!body.title?.trim()) return apiError('Title is required', 400)
  if (!body.contactId?.trim()) return apiError('contactId is required', 400)
  const dealTitle = body.title.trim()
  const contactId = body.contactId.trim()
  const currency = body.currency ?? 'ZAR'
  if (!VALID_CURRENCIES.includes(currency)) return apiError('Invalid currency — use USD, EUR, or ZAR', 400)
  const value = typeof body.value === 'number' ? body.value : 0

  // Resolve pipeline: explicit or default
  let pipelineId: string = body.pipelineId ?? ''
  if (!pipelineId) {
    const defaultPl = await getDefaultPipelineForOrg(ctx.orgId)
    if (!defaultPl) {
      return apiError('No pipeline configured for this workspace; create one first', 400)
    }
    pipelineId = defaultPl.id
  }

  // Validate pipelineId belongs to org
  const loaded = await loadPipeline(pipelineId, ctx.orgId)
  if (!loaded) return apiError('Invalid pipelineId', 400)
  const pipeline = loaded.data

  // Resolve stageId: explicit or first open stage (fallback: first stage)
  let stageId: string = body.stageId ?? ''
  if (!stageId) {
    const firstOpen = pipeline.stages.find(s => s.kind === 'open')
    stageId = firstOpen ? firstOpen.id : (pipeline.stages[0]?.id ?? '')
  } else {
    const stageExists = pipeline.stages.some(s => s.id === stageId)
    if (!stageExists) return apiError('Invalid stageId for pipeline', 400)
  }

  // PR 3 pattern 1: use ctx.actor directly (no snapshotForWrite)
  const actorRef: MemberRef = ctx.actor

  // PR 3 pattern 3: ownerRef on POST when ownerUid present
  let ownerRef: MemberRef | undefined
  if (typeof body.ownerUid === 'string' && body.ownerUid !== '') {
    ownerRef = await resolveMemberRef(ctx.orgId, body.ownerUid)
  }

  const dealData: Record<string, unknown> = {
    orgId: ctx.orgId,
    contactId,
    title: dealTitle,
    value,
    currency,
    pipelineId,
    stageId,
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
    stageHistory: [{
      pipelineId,
      stageId,
      enteredAt: Timestamp.now(),
      enteredByRef: actorRef,
    }],
  }

  // Auto-derive companyId from contact when not explicitly provided
  if (body.contactId && !body.companyId) {
    const derived = await deriveCompanyFromContact(body.contactId, ctx.orgId)
    Object.assign(dealData, derived)
  }
  // Explicit companyId in body always wins — validate and use it
  if (body.companyId) {
    const loadedCompany = await loadCompany(body.companyId, ctx.orgId)
    if (!loadedCompany) return apiError('Invalid companyId', 400)
    dealData.companyId = body.companyId
    dealData.companyName = loadedCompany.data.name
  }

  // Custom field validation (best-effort — Firestore outage must not block core write)
  if (body.customFields !== undefined && body.customFields !== null) {
    try {
      const defs = await getDefinitionsForResource(ctx.orgId, 'deal')
      const errs = validateCustomFields(defs, body.customFields as Record<string, unknown>)
      if (errs.length > 0) {
        return apiError(`Custom field validation failed: ${errs.map(e => `${e.key}: ${e.message}`).join('; ')}`, 400)
      }
    } catch (err) {
      console.error('custom-field-validation-skipped', err)
    }
  }

  // Firestore rejects undefined values — strip them before write
  const sanitized = Object.fromEntries(Object.entries(dealData).filter(([, v]) => v !== undefined))

  const docRef = adminDb.collection('deals').doc()
  await docRef.set(sanitized)

  // PR 3 pattern 2: explicit-field webhook payload (no body spread)
  try {
    await dispatchWebhook(ctx.orgId, 'deal.created', {
      id: docRef.id,
      title: dealTitle,
      value,
      pipelineId,
      stageId,
      contactId,
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
    description: `Created deal: "${dealTitle}"`,
    entityId: docRef.id,
    entityType: 'deal',
    entityTitle: dealTitle,
  }).catch(() => {})

  // ── Automation trigger (A6) — best-effort ──────────────────────────────────
  try {
    const { fireTrigger } = await import('@/lib/automations/trigger')
    await fireTrigger('deal.created', {
      orgId: ctx.orgId,
      dealId: docRef.id,
      contactId,
    })
  } catch { /* best-effort */ }

  return apiSuccess({ id: docRef.id }, 201)
})
