/**
 * GET /api/v1/admin/partners/export — CSV of all partner applications.
 */
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import type { PartnerApplication } from '@/lib/billing/types'

export const dynamic = 'force-dynamic'

function csvField(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function tsToIso(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'object' && value !== null && 'toMillis' in value) {
    try {
      return new Date((value as { toMillis: () => number }).toMillis()).toISOString()
    } catch {
      return ''
    }
  }
  if (typeof value === 'number') return new Date(value).toISOString()
  return ''
}

export const GET = withAuth('admin', async () => {
  const snap = await adminDb.collection('partner_applications').get()

  const apps = snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<PartnerApplication, 'id'>) }))
    .sort((a, b) => {
      const am = tsToIso(a.createdAt)
      const bm = tsToIso(b.createdAt)
      return bm.localeCompare(am)
    })

  const lines: string[] = []
  lines.push(
    ['Company', 'Contact', 'Email', 'Status', 'Commission %', 'Referrals', 'Total Commission ZAR', 'Created At']
      .map(csvField)
      .join(','),
  )

  for (const app of apps) {
    lines.push(
      [
        app.companyName ?? '',
        app.contactName ?? '',
        app.email ?? '',
        app.status ?? '',
        typeof app.commissionPercent === 'number' ? app.commissionPercent : '',
        app.referralsCount ?? 0,
        app.totalCommissionZar ?? 0,
        tsToIso(app.createdAt),
      ]
        .map(csvField)
        .join(','),
    )
  }

  const csv = lines.join('\n')
  const filename = `partners-export-${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
})
