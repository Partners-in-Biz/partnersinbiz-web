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
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  loadCompany,
  sanitizeCompanyForWrite,
  validateParentChain,
  validateAccountManager,
} from '@/lib/companies/store'
import { buildCompanyQuery, applyPostFilterSearch } from '@/lib/companies/filters'
import type { Company, CompanyInput, CompanyListParams } from '@/lib/companies/types'

// ── GET ─────────────────────────────────────────────────────────────────────────

export const GET = withCrmAuth('viewer', async (req, ctx) => {
  const { searchParams } = new URL(req.url)

  const params: CompanyListParams = {
    orgId:             ctx.orgId,
    search:            searchParams.get('search') ?? undefined,
    industry:          searchParams.get('industry') ?? undefined,
    size:              (searchParams.get('size') as CompanyListParams['size']) ?? undefined,
    tier:              (searchParams.get('tier') as CompanyListParams['tier']) ?? undefined,
    lifecycleStage:    (searchParams.get('lifecycleStage') as CompanyListParams['lifecycleStage']) ?? undefined,
    accountManagerUid: searchParams.get('accountManagerUid') ?? undefined,
    hasOpenDeals:      searchParams.get('hasOpenDeals') === 'true' ? true : undefined,
    limit:             Math.min(parseInt(searchParams.get('limit') ?? '50'), 200),
    cursor:            searchParams.get('cursor') ?? undefined,
    orderBy:           (searchParams.get('orderBy') as CompanyListParams['orderBy']) ?? 'createdAt-desc',
  }

  const tagsParam = searchParams.get('tags') ?? ''
  if (tagsParam) {
    params.tags = tagsParam.split(',').map(t => t.trim()).filter(Boolean)
  }

  const limit = Math.min(params.limit ?? 50, 200)
  const baseQuery = buildCompanyQuery(ctx.orgId, params)

  // Cursor-based pagination
  let query: FirebaseFirestore.Query = baseQuery
  if (params.cursor) {
    try {
      const cursorSnap = await adminDb.collection('companies').doc(params.cursor).get()
      if (cursorSnap.exists) query = query.startAfter(cursorSnap)
    } catch {
      // Invalid cursor — ignore and start from beginning
    }
  }

  const snapshot = await query.get()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const companiesFromSnapshot: Company[] = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }))
  let companies: Company[] = companiesFromSnapshot

  // Post-filter search (client-side substring match)
  if (params.search) {
    companies = applyPostFilterSearch(companies, params.search)
  }

  // hasOpenDeals filter: post-fetch check via count aggregation
  if (params.hasOpenDeals) {
    const openStages = ['discovery', 'proposal', 'negotiation']
    const withDeals: typeof companies = []
    await Promise.all(
      companies.map(async (company) => {
        try {
          const dealSnap = await adminDb.collection('deals')
            .where('orgId', '==', ctx.orgId)
            .where('companyId', '==', company.id)
            .where('stage', 'in', openStages)
            .limit(1)
            .get()
          if (!dealSnap.empty) withDeals.push(company)
        } catch {
          // Ignore index errors — include company by default
          withDeals.push(company)
        }
      }),
    )
    companies = withDeals
  }

  const nextCursor = snapshot.docs.length === limit
    ? snapshot.docs[snapshot.docs.length - 1]?.id
    : undefined

  return apiSuccess({ companies, nextCursor })
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

  // Validate account manager belongs to this org
  if (body.accountManagerUid) {
    const validAm = await validateAccountManager(ctx.orgId, body.accountManagerUid)
    if (!validAm) return apiError('accountManagerUid does not belong to this workspace', 400)
  }

  const sanitized = sanitizeCompanyForWrite(body)

  const now = Timestamp.now()
  const companyData: Record<string, unknown> = {
    orgId: ctx.orgId,
    ...sanitized,
    ownerUid: body.ownerUid ?? ctx.actor.uid,
    ownerRef: ctx.actor,
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

  return apiSuccess({ company: { ...toWrite, id: docRef.id } }, 201)
})

// Prevent unused import warning — loadCompany is used by other route files in this module
export { loadCompany }
