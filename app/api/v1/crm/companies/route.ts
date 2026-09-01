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
import { crmCreateAttribution } from '@/lib/api/actor'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import {
  sanitizeCompanyForWrite,
  validateParentChain,
  loadMemberRef,
  findDuplicateCompany,
} from '@/lib/companies/store'
import { applyPostFilterSearch, buildCompanyQuery } from '@/lib/companies/filters'
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
  isCrmRolePrivilegedActor,
  normalizeAllowedUserIds,
  normalizeSharedWithUserPatch,
} from '@/lib/crm/assignment-access'
import { memberCanPerformModuleAction } from '@/lib/orgMembers/access-policy'
import { safeTouchCrmLiveUpdate } from '@/lib/crm/live-updates'
import { filterCrmRowsForStaffClientOrg } from '@/lib/crm/staff-client-filter'

// ── GET ─────────────────────────────────────────────────────────────────────────

async function countFirestoreQuery(query: {
  count?: () => { get: () => Promise<{ data?: () => { count?: number } }> }
  get: () => Promise<{ docs?: unknown[] }>
}): Promise<number> {
  if (typeof query.count === 'function') {
    const aggregate = await query.count().get()
    const data = typeof aggregate.data === 'function' ? aggregate.data() : {}
    const count = data?.count
    return typeof count === 'number' && Number.isFinite(count) ? count : 0
  }
  const snap = await query.get()
  return Array.isArray(snap.docs) ? snap.docs.length : 0
}

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
    const canUseIndexedPage =
      isCrmPrivilegedActor(ctx) &&
      !ctx.staffClientOrgId &&
      !params.search &&
      !params.hasOpenDeals

    if (canUseIndexedPage) {
      let query = buildCompanyQuery(ctx.orgId, params).limit(limit + 1)
      let countQuery: FirebaseFirestore.Query = adminDb.collection('companies')
        .where('orgId', '==', ctx.orgId)
        .where('deleted', '==', false)

      if (params.industry) countQuery = countQuery.where('industry', '==', params.industry)
      if (params.size) countQuery = countQuery.where('size', '==', params.size)
      if (params.tier) countQuery = countQuery.where('tier', '==', params.tier)
      if (params.lifecycleStage) countQuery = countQuery.where('lifecycleStage', '==', params.lifecycleStage)
      if (params.accountManagerUid) countQuery = countQuery.where('accountManagerUid', '==', params.accountManagerUid)
      if (params.tags && params.tags.length > 0) {
        countQuery = countQuery.where('tags', 'array-contains-any', params.tags.slice(0, 10))
      }

      if (params.cursor) {
        const cursorDoc = await adminDb.collection('companies').doc(params.cursor).get()
        if (cursorDoc.exists) query = query.startAfter(cursorDoc)
      }

      const [total, snapshot] = await Promise.all([
        countFirestoreQuery(countQuery),
        query.get(),
      ])
      const rows = snapshot.docs
        .map((doc) => ({ ...(doc.data() as Company), id: doc.id }))
        .filter((company) => company.deleted !== true)
      const page = rows.slice(0, limit)
      const nextCursor = rows.length > limit ? page[page.length - 1]?.id : undefined
      return apiSuccess({ companies: page, nextCursor, orgId: ctx.orgId }, 200, { total, limit })
    }

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
    companies = filterCrmRowsForStaffClientOrg(ctx.staffClientOrgId, companies)

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
      const maybeTimestamp = value as { toDate?: () => Date; _seconds?: number; seconds?: number; _nanoseconds?: number; nanoseconds?: number }
      const seconds = maybeTimestamp._seconds ?? maybeTimestamp.seconds
      if (typeof seconds === 'number') {
        const nanos = maybeTimestamp._nanoseconds ?? maybeTimestamp.nanoseconds ?? 0
        return (seconds * 1000) + (typeof nanos === 'number' ? Math.floor(nanos / 1_000_000) : 0)
      }
      if (typeof maybeTimestamp.toDate === 'function') return maybeTimestamp.toDate().getTime()
      return 0
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
  // Action-level gate: members with CRM module on may create by default; an
  // explicit per-member create=false blocks it.
  if (!isCrmRolePrivilegedActor(ctx) && !memberCanPerformModuleAction(ctx.accessPolicy, 'crm', 'create')) {
    return apiError('CRM create is disabled for this team member', 403)
  }

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
  const duplicate = await findDuplicateCompany(ctx.orgId, sanitized as Partial<CompanyInput>)
  if (duplicate) {
    return apiError(
      `A company that looks like ${body.name.trim()} already exists in this workspace. Open or update the existing company instead of creating a duplicate.`,
      409,
      { duplicate },
    )
  }

  const allowedUserIds = normalizeAllowedUserIds((body as Record<string, unknown>).allowedUserIds)
  for (const uid of [body.accountManagerUid, ownerUid]) {
    if (typeof uid === 'string' && uid.trim() && !allowedUserIds.includes(uid.trim())) {
      allowedUserIds.push(uid.trim())
    }
  }
  // First-class share: sharedWithUserIds also becomes an allowed user (read path).
  const sharedWithUserIds = normalizeSharedWithUserPatch((body as Record<string, unknown>).sharedWithUserIds) ?? []
  for (const uid of sharedWithUserIds) {
    if (uid && !allowedUserIds.includes(uid)) allowedUserIds.push(uid)
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
    ...(sharedWithUserIds.length > 0 ? { sharedWithUserIds } : {}),
    assignedTo: ownerUid,
    assignedToRef: ownerRef,
    ownerUid,
    ownerRef,
    createdByRef: ctx.actor,
    updatedByRef: ctx.actor,
    ...crmCreateAttribution(ctx.user, ctx.actor.uid, ctx.isAgent),
    createdAt: now,
    updatedAt: now,
    deleted: false,
    ...(ctx.staffClientOrgId ? { linkedOrgId: ctx.staffClientOrgId } : {}),
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
