// GET /api/v1/portal/data-export?format=csv|json&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Stream-out of the client's own metrics rows. Trust signal: "your data is
// yours, not ours." Defaults to last 90 days, JSON.

import { NextRequest, NextResponse } from 'next/server'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { listMetrics } from '@/lib/metrics/query'
import { logActivity } from '@/lib/activity/log'
import { buildLifeOsExport, deleteOrAnonymiseLifeOsUserData, requestLifeOsDelete } from '@/lib/privacy/life-os-user-data'
import { FirestoreLifeOsUserDataStore } from '@/lib/privacy/life-os-user-data-firestore'
import { apiErrorFromException, apiSuccess } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export const GET = withPortalAuthAndRole('viewer', async (req: NextRequest, uid: string, orgId: string, role: string) => {
  const url = new URL(req.url)
  const format = (url.searchParams.get('format') ?? 'json').toLowerCase()
  const today = new Date().toISOString().slice(0, 10)
  let from = url.searchParams.get('from') ?? ''
  let to = url.searchParams.get('to') ?? today
  if (!DATE_RE.test(from)) {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 90)
    from = d.toISOString().slice(0, 10)
  }
  if (!DATE_RE.test(to)) to = today

  const rows = await listMetrics({ orgId, from, to })
  const lifeOsStore = new FirestoreLifeOsUserDataStore()
  const lifeOsExport = await buildLifeOsExport(lifeOsStore, {
    orgId,
    ownerUid: uid,
    actorUid: uid,
  })

  await logActivity({
    orgId,
    type: 'portal_data_exported',
    actorId: uid,
    actorName: uid,
    actorRole: role === 'admin' || role === 'ai' ? role : 'client',
    description: `Exported portal metrics data (${format}, ${from} to ${to})`,
    entityType: 'metrics_export',
  })

  const filename = `pib-metrics-${orgId}-${from}-to-${to}.${format === 'csv' ? 'csv' : 'json'}`

  if (format === 'csv') {
    const cols = ['date', 'propertyId', 'source', 'metric', 'value', 'currency', 'valueZar', 'dimension', 'dimensionValue']
    const lines = [cols.join(',')]
    for (const r of rows) {
      lines.push(cols.map((c) => csvEscape((r as unknown as Record<string, unknown>)[c])).join(','))
    }
    return new NextResponse(lines.join('\n'), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'private, no-store',
      },
    })
  }

  return new NextResponse(JSON.stringify({
    orgId,
    from,
    to,
    count: rows.length,
    rows,
    lifeOs: lifeOsExport.lifeOs,
  }, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
    },
  })
})


export const POST = withPortalAuthAndRole('viewer', async (_req: NextRequest, uid: string, orgId: string, role: string) => {
  try {
    const store = new FirestoreLifeOsUserDataStore()
    const request = await requestLifeOsDelete(store, { orgId, ownerUid: uid, actorUid: uid })
    await logActivity({
      orgId,
      type: 'portal_life_os_delete_requested',
      actorId: uid,
      actorName: uid,
      actorRole: role === 'admin' || role === 'ai' ? role : 'client',
      description: 'Requested Life OS personal data deletion',
      entityType: 'life_os_privacy_request',
      entityId: request.auditId,
    })
    return apiSuccess({ status: 'requested', ...request }, 202)
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const DELETE = withPortalAuthAndRole('viewer', async (_req: NextRequest, uid: string, orgId: string, role: string) => {
  try {
    const store = new FirestoreLifeOsUserDataStore()
    const report = await deleteOrAnonymiseLifeOsUserData(store, { orgId, ownerUid: uid, actorUid: uid })
    await logActivity({
      orgId,
      type: 'portal_life_os_deleted',
      actorId: uid,
      actorName: uid,
      actorRole: role === 'admin' || role === 'ai' ? role : 'client',
      description: `Deleted/anonymised Life OS personal data (${report.totals.deleted} deleted, ${report.totals.anonymised} anonymised)`,
      entityType: 'life_os_privacy_request',
      entityId: report.auditId,
    })
    return apiSuccess(report)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
