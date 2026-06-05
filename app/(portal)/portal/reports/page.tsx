'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ReportsWorkspace, type ReportsWorkspaceReport } from '@/components/reports/ReportsWorkspace'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function PortalReports() {
  const searchParams = useSearchParams()
  const routeScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const reportsUrl = useMemo(() => scopedApiPath('/api/v1/portal/reports', routeScope), [routeScope])
  const crmReportsHref = useMemo(() => scopedPortalPath('/portal/reports/crm', routeScope), [routeScope])
  const [reports, setReports] = useState<ReportsWorkspaceReport[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(reportsUrl)
      .then((r) => r.json())
      .then((b) => { setReports(b.reports ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [reportsUrl])

  return (
    <div className="space-y-10">
      <header>
        <p className="eyebrow">Performance reports</p>
        <h1 className="pib-page-title mt-2">Reports</h1>
        <p className="pib-page-sub max-w-2xl">
          Branded monthly performance reports — generated on the 1st of each month and shareable with your stakeholders.
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
        mode="portal"
        emptyMessage="The first monthly report will appear after the first full month of connected data."
      />
    </div>
  )
}
