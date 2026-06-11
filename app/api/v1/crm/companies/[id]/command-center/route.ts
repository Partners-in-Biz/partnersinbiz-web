import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { loadCompany } from '@/lib/companies/store'
import { buildCompanyCommandCenter } from '@/lib/companies/command-center'
import { filterCompanyCommandCenterForVisibility } from '@/lib/crm/visibility-policy'
import { decorateInvoiceEditCapability } from '@/lib/invoices/permissions'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

export const GET = withCrmAuth<RouteCtx>('viewer', async (req, ctx, routeCtx) => {
  const { id } = await routeCtx!.params
  const loaded = await loadCompany(id, ctx.orgId)
  if (!loaded) return apiError('Company not found', 404)
  const limit = Number(new URL(req.url).searchParams.get('limit') ?? 50)
  const commandCenter = await buildCompanyCommandCenter(loaded.data, { limit })
  const visibleCenter = filterCompanyCommandCenterForVisibility(commandCenter, ctx)
  return apiSuccess({
    ...visibleCenter,
    invoices: visibleCenter.invoices.map((invoice) => decorateInvoiceEditCapability(invoice, ctx.user ?? null)),
  })
})
