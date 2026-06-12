/**
 * GET  /api/v1/crm/companies — list companies (filterable, paginated)
 * POST /api/v1/crm/companies — create a new company
 *
 * Query params (GET):
 *   search, industry, size, tier, lifecycleStage, tags (comma-separated),
 *   accountManagerUid, hasOpenDeals (bool), limit (default 50, max 200),
 *   cursor, orderBy (default: createdAt-desc)
 *
 * Auth: GET → viewer+, POST → member+
 */
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import {
  loadCompany,
  sanitizeCompanyForWrite,
  validateParentChain,
  loadMemberRef,
} from '@/lib/companies/store'
import { applyPostFilterSearch } from '@/lib/companies/filters'
import type { Company, CompanyInput, CompanyListParams } from '@/lib/companies/types'
import { getDefinitionsForResource } from '@/lib/customFields/store'
import { validateCustomFields } from '@/lib/customFields/validation'
import {
  crmActorUid,
  type AssignableCrmRecord,
  crmRecordAssignedToUid,
  crmRecordCompanyIds,
  filterCrmRowsForActor,
  isCrmPrivilegedActor,
  normalizeAllowedUserIds,
} from '@/lib/crm/assignment-access'
import { safeTouchCrmLiveUpdate } from '@/lib/crm/live-updates'

// ── GET ─────────────────────────────────────────────────────────────────────────

export const GET = withCrmAuth('viewer', async (req, ctx) => {
  try {
    const { searchParams } = new URL(req.url)

    const parsedLimit = Number.parseInt(searchParams.get('limit') ?? '50', 10)
    const params: CompanyListParams = {
      orgId:             ctx.orgId,
      search:            searchParams.get('search') ?? undefined,
      industry:          searchParams.get('industry') ?? undefined,
      size:              (searchParams.get('size') as CompanyListParams['size']) ?? undefined,
      tier:              (searchParams.get('tier') as CompanyListParams['tier']) ?? undefined,
      lifecycleStage:    (searchParams.get('lifecycleStage') as CompanyListParams['lifecycleStage']) ?? undefined,
      accountManagerUid: searchParams.get('accountManagerUid') ?? undefined,
      hasOpenDeals:      searchParams.get('hasOpenDeals') === 'true' ? true : undefined,
      limit:             Number.isFinite(parsedLimit) ? Math.min(parsedLimit, 200) : 50,
      cursor:            searchParams.get('cursor') ?? undefined,
      orderBy:           (searchParams.get('orderBy') as CompanyListParams['orderBy']) ?? 'createdAt-desc',
    }

    const tagsParam = searchParams.get('tags') ?? ''
    if (tagsParam) {
      params.tags = tagsParam.split(',').map(t => t.trim()).filter(Boolean)
    }

    const limit = Math.min(params.limit ?? 50, 200)

    // Keep the list route index-safe. Production workspaces can land before the
    // newest composite indexes are deployed, so query only by tenant and do the
    // small dashboard/list filters in memory.
    const snapshot = await adminDb.collection('companies')
      .where('orgId', '==', ctx.orgId)
      .limit(1000)
      .get()

    let companies: Company[] = snapshot.docs
      .map((doc) => ({ ...(doc.data() as Company), id: doc.id }))
      .filter((company) => company.deleted !== true)

    if (!isCrmPrivilegedActor(ctx)) {
      const directCompanies = filterCrmRowsForActor(ctx, companies)
      const visibleIds = new Set(directCompanies.map((company) => company.id))
      const actorUid = crmActorUid(ctx)
      const contactsSnap = await adminDb.collection('contacts')
        .where('orgId', '==', ctx.orgId)
        .limit(1000)
        .get()
      for (const doc of contactsSnap.docs) {
        const contact = { id: doc.id, ...doc.data() } as AssignableCrmRecord
        if (contact.deleted === true || !crmRecordAssignedToUid(contact, actorUid)) continue
        for (const companyId of crmRecordCompanyIds(contact)) visibleIds.add(companyId)
      }
      companies = companies.filter((company) => visibleIds.has(company.id))
    }

    if (params.industry) {
      companies = companies.filter((company) => company.industry === params.industry)
    }
    if (params.size) {
      companies = companies.filter((company) => company.size === params.size)
    }
    if (params.tier) {
      companies = companies.filter((company) => company.tier === params.tier)
    }
    if (params.lifecycleStage) {
      companies = companies.filter((company) => company.lifecycleStage === params.lifecycleStage)
    }
    if (params.accountManagerUid) {
      companies = companies.filter((company) => company.accountManagerUid === params.accountManagerUid)
    }
    if (params.tags && params.tags.length > 0) {
      companies = companies.filter((company) => {
        const tags = Array.isArray(company.tags) ? company.tags : []
        return params.tags?.some((tag) => tags.includes(tag))
      })
    }

    if (params.search) {
      companies = applyPostFilterSearch(companies, params.search)
    }

    if (params.hasOpenDeals) {
      const dealSnap = await adminDb.collection('deals')
        .where('orgId', '==', ctx.orgId)
        .limit(1000)
        .get()

      const companyIdsWithOpenDeals = new Set(
        dealSnap.docs
          .map((doc) => doc.data() as { companyId?: string; deleted?: boolean; lostReason?: string; probability?: number })
          .filter((deal) => deal.deleted !== true)
          .filter((deal) => deal.companyId && !deal.lostReason && (deal.probability ?? 50) < 100)
          .map((deal) => deal.companyId as string),
      )
      companies = companies.filter((company) => companyIdsWithOpenDeals.has(company.id))
    }

    const toMillis = (value: unknown): number => {
      if (!value) return 0
      if (value instanceof Date) return value.getTime()
      const maybeTimestamp = value as { toDate?: () => Date; _seconds?: number; seconds?: number }
      if (typeof maybeTimestamp.toDate === 'function') return maybeTimestamp.toDate().getTime()
      const seconds = maybeTimestamp._seconds ?? maybeTimestamp.seconds
      return typeof seconds === 'number' ? seconds * 1000 : 0
    }

    companies = [...companies].sort((a, b) => {
      if (params.orderBy === 'name-asc') {
        return (a.name ?? '').localeCompare(b.name ?? '')
      }
      if (params.orderBy === 'updatedAt-desc') {
        return toMillis(b.updatedAt) - toMillis(a.updatedAt)
      }
      return toMillis(b.createdAt) - toMillis(a.createdAt)
    })

    const cursorIndex = params.cursor
      ? companies.findIndex((company) => company.id === params.cursor)
      : -1
    const start = cursorIndex >= 0 ? cursorIndex + 1 : 0
    const page = companies.slice(start, start + limit)
    const nextCursor = start + limit < companies.length ? page[page.length - 1]?.id : undefined

    return apiSuccess({ companies: page, nextCursor, orgId: ctx.orgId })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

// ── POST ────────────────────────────────────────────────────────────────────────

export const POST = withCrmAuth('member', async (req, ctx) => {
  let body: Partial<CompanyInput>
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON', 400)
  }

  if (!body.name?.trim()) return apiError('Name is required', 400)

  // Validate parent chain (cycle + cross-tenant guard)
  if (body.parentCompanyId) {
    const validChain = await validateParentChain(ctx.orgId, undefined, body.parentCompanyId)
    if (!validChain) return apiError('Invalid parentCompanyId: creates a cycle or crosses tenants', 400)
  }

  // Validate account manager belongs to this org + resolve ref snapshot
  let accountManagerRef = undefined
  if (body.accountManagerUid) {
    if (!isCrmPrivilegedActor(ctx) && body.accountManagerUid !== ctx.actor.uid) {
      return apiError('You can only assign companies to yourself with your current CRM access', 403)
    }
    accountManagerRef = await loadMemberRef(ctx.orgId, body.accountManagerUid)
    if (!accountManagerRef) return apiError('accountManagerUid does not belong to this workspace', 400)
  }

  const ownerUidInput = typeof body.ownerUid === 'string' ? body.ownerUid.trim() : ''
  if (!isCrmPrivilegedActor(ctx) && ownerUidInput && ownerUidInput !== ctx.actor.uid) {
    return apiError('You can only own companies assigned to yourself with your current CRM access', 403)
  }
  const ownerUid = ownerUidInput || ctx.actor.uid
  let ownerRef = ctx.actor
  if (ownerUid !== ctx.actor.uid) {
    const resolvedOwnerRef = await loadMemberRef(ctx.orgId, ownerUid)
    if (!resolvedOwnerRef) return apiError('ownerUid does not belong to this workspace', 400)
    ownerRef = resolvedOwnerRef
  }

  const sanitized = sanitizeCompanyForWrite(body)
  const allowedUserIds = normalizeAllowedUserIds((body as Record<string, unknown>).allowedUserIds)
  for (const uid of [body.accountManagerUid, ownerUid]) {
    if (typeof uid === 'string' && uid.trim() && !allowedUserIds.includes(uid.trim())) {
      allowedUserIds.push(uid.trim())
    }
  }

  // Custom field validation (best-effort — Firestore outage must not block core write)
  if (body.customFields !== undefined && body.customFields !== null) {
    try {
      const defs = await getDefinitionsForResource(ctx.orgId, 'company')
      const errs = validateCustomFields(defs, body.customFields as Record<string, unknown>)
      if (errs.length > 0) {
        return apiError(`Custom field validation failed: ${errs.map(e => `${e.key}: ${e.message}`).join('; ')}`, 400)
      }
    } catch (err) {
      console.error('custom-field-validation-skipped', err)
    }
  }

  const now = Timestamp.now()
  const companyData: Record<string, unknown> = {
    orgId: ctx.orgId,
    ...sanitized,
    accountManagerRef,
    ...(allowedUserIds.length > 0 ? { allowedUserIds } : {}),
    ownerUid,
    ownerRef,
    createdBy: ctx.isAgent ? undefined : ctx.actor.uid,
    createdByRef: ctx.actor,
    updatedBy: ctx.isAgent ? undefined : ctx.actor.uid,
    updatedByRef: ctx.actor,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }

  // Strip undefined values (Firestore rejects them)
  const toWrite = Object.fromEntries(
    Object.entries(companyData).filter(([, v]) => v !== undefined),
  )

  const docRef = adminDb.collection('companies').doc()
  await docRef.set(toWrite)
  await safeTouchCrmLiveUpdate(ctx.orgId, 'companies', 'company.created')

  return apiSuccess({ company: { ...toWrite, id: docRef.id } }, 201)
})

// Prevent unused import warning — loadCompany is used by other route files in this module
export { loadCompany }
