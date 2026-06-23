/**
 * GET /api/v1/admin/legal/compliance/runs  — list recent report runs (?reportId)
 *
 * Firestore collection `compliance_report_runs`.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { serializeGovernance, toMillis, cleanStr } from '@/lib/governance/firestore'

export const dynamic = 'force-dynamic'

const COLLECTION = 'compliance_report_runs'

export const GET = withAuth('admin', async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url)
    const reportId = cleanStr(searchParams.get('reportId'), 120) || null

    let query: FirebaseFirestore.Query = adminDb.collection(COLLECTION)
    if (reportId) query = query.where('reportId', '==', reportId)
    const snap = await query.limit(500).get()

    const runs = snap.docs
      .map((d) => serializeGovernance({ id: d.id, ...d.data() }))
      .sort((a, b) => toMillis(b.generatedAt) - toMillis(a.generatedAt))
      .slice(0, 100)

    return apiSuccess({ runs })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
