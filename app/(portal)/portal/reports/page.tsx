'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ReportsWorkspace, type ReportsWorkspaceReport } from '@/components/reports/ReportsWorkspace'

function scopedPortalHref(path: string, orgId: string, orgSlug: string) {
  if (!orgId) return path
  const params = new URLSearchParams({ orgId })
  if (orgSlug) params.set('orgSlug', orgSlug)
  return `${path}${path.includes('?') ? '&' : '?'}${params.toString()}`
}

export default function PortalReports() {
  const searchParams = useSearchParams()
  const scopedOrgId = searchParams.get('orgId')?.trim() ?? ''
  const scopedOrgSlug = searchParams.get('orgSlug')?.trim() ?? ''
  const [reports, setReports] = useState<ReportsWorkspaceReport[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const reportsUrl = scopedOrgId
      ? `/api/v1/portal/reports?orgId=${encodeURIComponent(scopedOrgId)}`
      : '/api/v1/portal/reports'
    fetch(reportsUrl)
      .then((r) => r.json())
      .then((b) => { setReports(b.reports ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [scopedOrgId])

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
            href={scopedPortalHref('/portal/reports/crm', scopedOrgId, scopedOrgSlug)}
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
