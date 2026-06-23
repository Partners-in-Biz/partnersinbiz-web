/**
 * POST /api/v1/admin/legal/compliance/[id]/generate
 *
 * Generate a report run NOW with REAL computed numbers:
 *   - gdpr_requests counts by status
 *   - legal_acceptances total count
 *   - admin user count (users where role === 'admin')
 *   - open support tickets count (support_tickets where status === 'open')
 *
 * Stores the run in `compliance_report_runs` and updates the config's
 * lastGeneratedAt + nextRunAt (for weekly/monthly schedules). This stores the
 * structured data; a PDF renderer can be layered on later — we do NOT fake a PDF.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { serializeGovernance, genId, actorOf } from '@/lib/governance/firestore'

export const dynamic = 'force-dynamic'

const CONFIG_COLLECTION = 'compliance_reports'
const RUNS_COLLECTION = 'compliance_report_runs'
type RouteContext = { params: Promise<{ id: string }> }

const GDPR_STATUSES = ['open', 'in_progress', 'completed', 'rejected']

async function countByStatus(collection: string, statuses: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  // Use Firestore aggregate count() per status — cheap, single-field equality.
  await Promise.all(
    statuses.map(async (s) => {
      try {
        const agg = await adminDb.collection(collection).where('status', '==', s).count().get()
        out[s] = agg.data().count
      } catch {
        out[s] = 0
      }
    }),
  )
  return out
}

async function countWhere(collection: string, field: string, value: string): Promise<number> {
  try {
    const agg = await adminDb.collection(collection).where(field, '==', value).count().get()
    return agg.data().count
  } catch {
    return 0
  }
}

async function countAll(collection: string): Promise<number> {
  try {
    const agg = await adminDb.collection(collection).count().get()
    return agg.data().count
  } catch {
    return 0
  }
}

function nextRun(schedule: string, from: Date): string | null {
  const d = new Date(from)
  if (schedule === 'weekly') {
    d.setDate(d.getDate() + 7)
    return d.toISOString()
  }
  if (schedule === 'monthly') {
    d.setMonth(d.getMonth() + 1)
    return d.toISOString()
  }
  return null
}

export const POST = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  try {
    const { id } = await ctx.params
    const configRef = adminDb.collection(CONFIG_COLLECTION).doc(id)
    const configSnap = await configRef.get()
    if (!configSnap.exists) return apiError('Report config not found', 404)
    const config = configSnap.data() as Record<string, unknown>

    const [gdprByStatus, legalAcceptancesCount, adminUserCount, openSupportTickets] = await Promise.all([
      countByStatus('gdpr_requests', GDPR_STATUSES),
      countAll('legal_acceptances'),
      countWhere('users', 'role', 'admin'),
      countWhere('support_tickets', 'status', 'open'),
    ])

    const gdprTotal = Object.values(gdprByStatus).reduce((a, b) => a + b, 0)

    const data = {
      gdprRequests: { total: gdprTotal, byStatus: gdprByStatus },
      legalAcceptances: { total: legalAcceptancesCount },
      adminUsers: { total: adminUserCount },
      supportTickets: { open: openSupportTickets },
    }

    const summary =
      `Compliance snapshot (${config.type}): ` +
      `${gdprTotal} GDPR request(s) [${gdprByStatus.open ?? 0} open, ${gdprByStatus.completed ?? 0} completed], ` +
      `${legalAcceptancesCount} legal acceptance(s), ` +
      `${adminUserCount} admin user(s), ` +
      `${openSupportTickets} open support ticket(s). ` +
      `Structured data stored; a PDF renderer can be layered on later.`

    const now = new Date()
    const runId = genId('crun')
    const runRecord = {
      reportId: id,
      reportName: config.name ?? null,
      reportType: config.type ?? null,
      generatedAt: FieldValue.serverTimestamp(),
      summary,
      data,
      generatedBy: actorOf(user),
    }
    await adminDb.collection(RUNS_COLLECTION).doc(runId).set(runRecord)

    const schedule = String(config.schedule || 'manual')
    await configRef.update({
      status: 'generated',
      lastGeneratedAt: FieldValue.serverTimestamp(),
      nextRunAt: nextRun(schedule, now),
      updatedAt: FieldValue.serverTimestamp(),
    })

    const savedRun = await adminDb.collection(RUNS_COLLECTION).doc(runId).get()
    return apiSuccess({ run: serializeGovernance({ id: runId, ...savedRun.data() }) }, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
