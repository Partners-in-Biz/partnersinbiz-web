import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'
import { loadAuditLog, parseFilters } from './data'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  try {
    const url = new URL(req.url)
    const filters = parseFilters(url.searchParams)
    const limitParam = Number.parseInt(url.searchParams.get('limit') ?? '', 10)
    const scanParam = Number.parseInt(url.searchParams.get('scan') ?? '', 10)
    const result = await loadAuditLog(user, filters, {
      limit: Number.isFinite(limitParam) ? limitParam : undefined,
      scan: Number.isFinite(scanParam) ? scanParam : undefined,
    })
    return apiSuccess(result)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
