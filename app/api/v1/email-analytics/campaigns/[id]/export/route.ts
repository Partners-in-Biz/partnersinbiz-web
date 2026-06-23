/**
 * GET /api/v1/email-analytics/campaigns/[id]/export
 * Auth: client. Streams a CSV of per-contact campaign activity:
 *   email, name, sent, delivered, opened, clicked, bounced, status, lastEngagedAt
 */
import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError } from '@/lib/api/response'
import { getCampaignStats } from '@/lib/email-analytics/aggregate'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

function csvCell(value: string | number | null): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export const GET = withAuth(
  'client',
  async (_req: NextRequest, user: ApiUser, context?: unknown) => {
    const { id } = await (context as Params).params
    const snap = await adminDb.collection('campaigns').doc(id).get()
    if (!snap.exists || snap.data()?.deleted === true) {
      return apiError('Campaign not found', 404)
    }
    const scope = resolveOrgScope(user, (snap.data()?.orgId as string | undefined) ?? null)
    if (!scope.ok) return apiError(scope.error, scope.status)

    let stats
    try {
      stats = await getCampaignStats(scope.orgId, id)
    } catch (err) {
      return apiError((err as Error).message || 'Campaign not found', 404)
    }

    const header = [
      'email',
      'name',
      'sent',
      'delivered',
      'opened',
      'clicked',
      'bounced',
      'status',
      'lastEngagedAt',
    ]
    const lines = [header.join(',')]
    for (const r of stats.contactActivity) {
      lines.push(
        [
          csvCell(r.email),
          csvCell(r.name),
          csvCell(r.sent),
          csvCell(r.delivered),
          csvCell(r.opened),
          csvCell(r.clicked),
          csvCell(r.bounced),
          csvCell(r.status),
          csvCell(r.lastEngagedAt),
        ].join(','),
      )
    }
    const csv = lines.join('\n')
    const safeName = (stats.name || 'campaign').replace(/[^a-z0-9-_]+/gi, '-').slice(0, 60)

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="campaign-${safeName}-activity.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  },
)
