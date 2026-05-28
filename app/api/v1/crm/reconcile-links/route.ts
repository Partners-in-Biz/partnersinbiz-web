import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { reconcileCrmLinks } from '@/lib/crm/reconcile-links'

export const dynamic = 'force-dynamic'

export const POST = withCrmAuth('admin', async (req, ctx) => {
  const body = await req.json().catch(() => ({}))
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
  const mode = (body as Record<string, unknown>).mode === 'apply' ? 'apply' : 'dry-run'
  if (mode === 'apply' && (body as Record<string, unknown>).approved !== true) {
    return apiError('Reconciliation apply mode requires approved: true after reviewing a dry-run report', 400)
  }
  const result = await reconcileCrmLinks(ctx.orgId, {
    mode,
    companyId: typeof (body as Record<string, unknown>).companyId === 'string' ? (body as Record<string, unknown>).companyId as string : undefined,
    limit: Number((body as Record<string, unknown>).limit ?? 500),
  }, ctx.actor)
  return apiSuccess(result)
})
