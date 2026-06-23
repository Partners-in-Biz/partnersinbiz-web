'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ReportsWorkspace, type ReportsWorkspaceReport } from '@/components/reports/ReportsWorkspace'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

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
    <div className="space-y-10">
      <header>
        <p className="eyebrow">Performance reports</p>
        <h1 className="pib-page-title mt-2">Reports</h1>
        <p className="pib-page-sub max-w-2xl">
          Branded performance reports — generated monthly, built custom, scheduled, and shareable with your stakeholders.
        </p>
      </header>

      {/* Quick links to sub-reports */}
      <section>
        <p className="eyebrow mb-3">Analytics</p>
        <div className="flex flex-wrap gap-3">
          <Link
            href={crmReportsHref}
            className="bento-card !p-4 flex items-center gap-3 hover:border-[var(--color-pib-accent)] transition-colors group min-w-[200px]"
          >
            <span className="material-symbols-outlined text-[22px] text-[var(--color-pib-accent)]">contacts</span>
            <div>
              <p className="text-sm font-medium text-[var(--color-pib-text)]">CRM Reports</p>
              <p className="text-xs text-[var(--color-pib-text-muted)]">Pipeline · Forecast · Activity</p>
            </div>
            <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)] group-hover:text-[var(--color-pib-accent)] ml-auto transition-colors">arrow_outward</span>
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
