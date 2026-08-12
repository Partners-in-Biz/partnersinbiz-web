// GET /api/v1/portal/dashboard
//
// One-shot fetch for the portal dashboard. Returns:
//   - org KPIs for the current month and prior month delta
//   - per-property tiles (counts of connections + last sync per property)
//   - latest report (if any) with public link

import { NextRequest, NextResponse } from 'next/server'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { loadOrgMemberAccessPolicy } from '@/lib/orgMembers/org-access-policy'
import { snapshotKpis, lastCompletedMonth, monthPeriod } from '@/lib/reports/snapshot'
import { listConnectionsForOrg } from '@/lib/integrations/connections'
import { listReports } from '@/lib/reports/generate'
import { getPortalDashboardProjectSummary, getPortalDashboardSummary } from '@/lib/portal/dashboard-summary'

export const dynamic = 'force-dynamic'

interface PortalProperty {
  id: string
  name: string
  type: string
  domain: string
}

async function listProps(orgId: string): Promise<PortalProperty[]> {
  const snap = await adminDb
    .collection('properties')
    .where('orgId', '==', orgId)
    .where('deleted', '==', false)
    .get()
  return snap.docs.map((d) => {
    const data = d.data() as PortalProperty
    return { id: d.id, name: data.name, type: data.type, domain: data.domain }
  })
}

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, uid: string, orgId: string) => {
  // Use the current month-to-date for the live dashboard.
  const now = new Date()
  const tz = 'UTC' // Portal users see UTC for now; server-rendered, no timezone leakage.
  const yyyyMm = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const period = monthPeriod(yyyyMm, tz)
  // Cap end at today.
  period.end = now.toISOString().slice(0, 10)

  const memberAccessPolicy = await loadOrgMemberAccessPolicy(orgId, uid)
  const projectViewer: ApiUser = {
    uid,
    role: 'client',
    orgId,
    activeOrgId: orgId,
    orgIds: [orgId],
    memberAccessPolicy: memberAccessPolicy ?? undefined,
  }
  const emptyProjects = { total: 0, active: 0, recent: [] }

  const [snapshot, properties, connections, reports, summary, projects] = await Promise.all([
    snapshotKpis({ orgId, period, previousPeriod: lastCompletedMonth(tz) }).catch(() => null),
    listProps(orgId).catch(() => []),
    listConnectionsForOrg(orgId).catch(() => []),
    listReports(orgId, 6).catch(() => []),
    getPortalDashboardSummary(orgId).catch(() => null),
    getPortalDashboardProjectSummary(orgId, projectViewer).catch(() => emptyProjects),
  ])

  const scopedSummary = summary
    ? {
        ...summary,
        counts: {
          ...summary.counts,
          projects: projects.total,
          activeProjects: projects.active,
        },
        projects,
      }
    : null

  // Strip ciphertext from connections shown in portal.
  const safeConnections = connections.map(({ credentialsEnc: _e, ...rest }) => ({
    ...rest,
    hasCredentials: Boolean(_e),
  }))

  return NextResponse.json({
    ok: true,
    orgId,
    period,
    kpis: snapshot?.kpis ?? null,
    series: snapshot?.series ?? null,
    properties,
    connections: safeConnections,
    summary: scopedSummary
      ? {
          ...scopedSummary,
          onboarding: {
            ...scopedSummary.onboarding,
            analytics: safeConnections.length > 0,
          },
        }
      : null,
    reports: reports.map((r) => ({
      id: r.id,
      type: r.type,
      period: r.period,
      status: r.status,
      publicToken: r.publicToken,
      kpis: { total_revenue: r.kpis.total_revenue, mrr: r.kpis.mrr },
      sentAt: r.sentAt,
      createdAt: r.createdAt,
    })),
  })
})
