/**
 * GET /api/v1/admin/legal/acceptances
 *   ?docType ?orgId  — filter
 *   ?limit            — max rows (default 200, cap 200)
 *   ?format=csv       — stream a CSV download of acceptance rows
 *
 * Firestore collection `legal_acceptances`:
 *   { orgId, userId, docType, version, acceptedAt, ip, userEmail? }
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { serializeGovernance, toMillis, cleanStr } from '@/lib/governance/firestore'

export const dynamic = 'force-dynamic'

const COLLECTION = 'legal_acceptances'

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export const GET = withAuth('admin', async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url)
    const docType = cleanStr(searchParams.get('docType'), 60) || null
    const orgId = cleanStr(searchParams.get('orgId'), 120) || null
    const format = cleanStr(searchParams.get('format'), 10).toLowerCase()
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 200, 1), 200)

    // Single-field equality query (whichever filter is provided) then in-memory filter + sort.
    let query: FirebaseFirestore.Query = adminDb.collection(COLLECTION)
    if (orgId) query = query.where('orgId', '==', orgId)
    else if (docType) query = query.where('docType', '==', docType)
    const snap = await query.limit(1500).get()

    let rows = snap.docs.map((d) => serializeGovernance({ id: d.id, ...d.data() }))
    if (orgId && docType) rows = rows.filter((r) => r.docType === docType)
    if (docType && !orgId) rows = rows.filter((r) => r.docType === docType)
    rows.sort((a, b) => toMillis(b.acceptedAt) - toMillis(a.acceptedAt))
    rows = rows.slice(0, format === 'csv' ? 100000 : limit)

    if (format === 'csv') {
      const header = ['id', 'orgId', 'userId', 'userEmail', 'docType', 'version', 'acceptedAt', 'ip']
      const lines = [header.join(',')]
      for (const r of rows) {
        lines.push(
          [r.id, r.orgId, r.userId, r.userEmail, r.docType, r.version, r.acceptedAt, r.ip]
            .map(csvCell)
            .join(','),
        )
      }
      const csv = lines.join('\r\n')
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="legal-acceptances-${Date.now()}.csv"`,
        },
      })
    }

    return apiSuccess({ acceptances: rows, count: rows.length })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
