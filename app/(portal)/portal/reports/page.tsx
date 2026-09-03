'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ReportsWorkspace, type ReportsWorkspaceReport } from '@/components/reports/ReportsWorkspace'
import { SharedWithUsSection } from '@/components/crm/SharedWithUsSection'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import { Icon } from '@/components/studio'
import { PageHeader } from '@/components/ui/AppFoundation'

export default function PortalReports() {
  const searchParams = useSearchParams()
  const routeScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const reportsUrl = useMemo(() => scopedApiPath('/api/v1/portal/reports', routeScope), [routeScope])
  const crmReportsHref = useMemo(() => scopedPortalPath('/portal/reports/crm', routeScope), [routeScope])
  const newReportHref = useMemo(() => scopedPortalPath('/portal/reports/new', routeScope), [routeScope])
  const orgId = routeScope.orgId ?? null
  const [reports, setReports] = useState<ReportsWorkspaceReport[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  const load = useCallback(() => {
    fetch(reportsUrl)
      .then((r) => r.json())
      .then((b) => { setReports(b.reports ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [reportsUrl])

  useEffect(() => { load() }, [load])

  const scopedAdminApi = useCallback(
    (path: string) => (orgId ? `${path}${path.includes('?') ? '&' : '?'}orgId=${encodeURIComponent(orgId)}` : path),
    [orgId],
  )

  const generateMonthly = useCallback(async () => {
    setGenerating(true)
    try {
      const res = await fetch(scopedAdminApi('/api/v1/reports'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, type: 'monthly' }),
      })
      if (!res.ok) throw new Error('generate failed')
      load()
    } catch {
      alert('Could not generate the report. You may not have permission for this workspace.')
    } finally {
      setGenerating(false)
    }
  }, [orgId, scopedAdminApi, load])

  return (
    <div className="space-y-6">
      <SharedWithUsSection module="analytics" orgId={orgId ?? undefined} companyId={routeScope.sourceCompanyId} />
      <PageHeader
        eyebrow="Performance reports"
        title="Reports."
        description="Branded performance reports, generated monthly, built custom, scheduled, and shareable with your stakeholders."
      />

      {/* Quick links to sub-reports */}
      <section>
        <p className="sc-tiny mb-3">Analytics</p>
        <div className="flex flex-wrap gap-3">
          <Link
            href={crmReportsHref}
            className="st-panel !p-4 flex items-center gap-3 hover:border-[var(--color-pib-accent)] transition-colors group min-w-[200px]"
          >
            <Icon name="contacts" />
            <div>
              <p className="text-sm font-medium text-[var(--color-pib-text)]">CRM Reports</p>
              <p className="text-xs text-[var(--color-pib-text-muted)]">Pipeline · Forecast · Activity</p>
            </div>
            <Icon name="arrow_outward" className="ml-auto" />
          </Link>
        </div>
      </section>

      <ReportsWorkspace
        reports={reports}
        loading={loading}
        mode="admin"
        orgId={orgId}
        newReportHref={newReportHref}
        onGenerate={generateMonthly}
        generating={generating}
        onMutated={load}
        emptyMessage="The first monthly report will appear after the first full month of connected data. Or build a custom report now."
      />
    </div>
  )
}
