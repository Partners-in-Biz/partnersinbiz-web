import { withAuth } from '@/lib/api/auth'
import { apiErrorFromException } from '@/lib/api/response'
import { loadAuditLog, parseFilters, buildCsv } from '../data'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req, user) => {
  try {
    const url = new URL(req.url)
    const filters = parseFilters(url.searchParams)
    // Export honours the same filters but pulls the full filtered set (cap high).
    const result = await loadAuditLog(user, filters, { scan: 5000, limit: 5000 })
    const csv = buildCsv(result.rows)
    const stamp = new Date().toISOString().slice(0, 10)
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-log-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
