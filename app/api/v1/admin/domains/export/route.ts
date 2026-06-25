// app/api/v1/admin/domains/export/route.ts
//
// CSV export of the admin white-label domain inventory (US-279).

import { withAuth } from '@/lib/api/auth'
import { apiErrorFromException } from '@/lib/api/response'
import { loadDomains, buildDomainsCsv } from '../data'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (_req, user) => {
  try {
    const result = await loadDomains(user)
    const csv = buildDomainsCsv(result.rows)
    const stamp = new Date().toISOString().slice(0, 10)
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="white-label-domains-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
