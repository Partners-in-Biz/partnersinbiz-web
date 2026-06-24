// app/api/v1/admin/reports/templates/[id]/versions/route.ts
//
// Version history for a single report template (US-289).

import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { listVersions } from '../../data'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (_req, _user, context) => {
  try {
    const params = await context?.params
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) return apiError('id is required', 400)
    if (id.startsWith('builtin:')) {
      // Built-in templates have a single immutable definition — no history.
      return apiSuccess({ versions: [] })
    }
    const versions = await listVersions(id)
    return apiSuccess({ versions })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
