/**
 * GET /api/v1/social/reports — List generated social reports for the org, newest first.
 */
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */

function tsToMs(ts: any): number {
  if (!ts) return 0
  if (ts._seconds != null) return ts._seconds * 1000
  if (ts.seconds != null) return ts.seconds * 1000
  return 0
}

export const GET = withAuth(
  'client',
  withTenant(async (req, _user, orgId) => {
    try {
      const { searchParams } = new URL(req.url)
      const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 200)

      const snap = await adminDb
        .collection('social_reports')
        .where('orgId', '==', orgId)
        .get()

      const reports = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as any)
        .sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt))
        .slice(0, limit)

      return apiSuccess(reports, 200, { total: reports.length })
    } catch (err) {
      return apiErrorFromException(err)
    }
  }),
)
