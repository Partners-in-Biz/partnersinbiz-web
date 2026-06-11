// GET /api/v1/crm/companies/:id/invoices — list invoices linked to a company
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { loadCompany } from '@/lib/companies/store'
import { decorateInvoiceEditCapability } from '@/lib/invoices/permissions'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }
type RelatedRow = { id: string; [key: string]: unknown }

function timeValue(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'object') {
    const timestamp = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

export const GET = withCrmAuth<RouteCtx>('viewer', async (req, ctx, routeCtx) => {
  const { id: companyId } = await routeCtx!.params
  const company = await loadCompany(companyId, ctx.orgId)
  if (!company) return apiError('Not found', 404)

  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 200)

  const snap = await adminDb
    .collection('invoices')
    .where('orgId', '==', ctx.orgId)
    .limit(1000)
    .get()

  const linkedOrgId = company.data.linkedOrgId
  const invoices = snap.docs
    .map((d): RelatedRow => ({ id: d.id, ...d.data() }))
    .filter((invoice) => (
      invoice.companyId === companyId ||
      invoice.sourceCompanyId === companyId ||
      (linkedOrgId && (
        invoice.recipientOrgId === linkedOrgId ||
        invoice.targetOrgId === linkedOrgId ||
        invoice.legacyOrgId === linkedOrgId
      ))
    ))
    .sort((a, b) => timeValue(b.updatedAt ?? b.createdAt ?? b.issueDate) - timeValue(a.updatedAt ?? a.createdAt ?? a.issueDate))
    .slice(0, limit)

  return apiSuccess({ invoices: invoices.map((invoice) => decorateInvoiceEditCapability(invoice, ctx.user ?? null)) })
})
