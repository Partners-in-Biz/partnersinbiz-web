'use client'
export const dynamic = 'force-dynamic'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { scopeFromSearchParams, scopedPortalPath } from '@/lib/portal/scoped-routing'
import { CustomReportBuilder } from '@/components/reports/CustomReportBuilder'

export default function NewCustomReport() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const routeScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const orgId = routeScope.orgId ?? null
  const backHref = useMemo(() => scopedPortalPath('/portal/reports', routeScope), [routeScope])
  const [savedToken, setSavedToken] = useState<string | null>(null)

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow">Custom report</p>
          <h1 className="pib-page-title mt-2">Report builder</h1>
          <p className="pib-page-sub max-w-2xl">
            Assemble a report from sections — text, metrics, charts, tables and page breaks. Snapshot sections pull live numbers for the period.
          </p>
        </div>
        <Link href={backHref} className="btn-pib-secondary !py-2 !px-4 !text-sm">
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Back to reports
        </Link>
      </header>

      {savedToken ? (
        <div className="bento-card !p-6 text-center space-y-4">
          <span className="material-symbols-outlined text-4xl text-emerald-300">check_circle</span>
          <h2 className="font-display text-2xl">Report generated.</h2>
          <div className="flex items-center justify-center gap-3">
            <Link href={`/reports/${savedToken}`} target="_blank" className="btn-pib-accent !py-2 !px-4 !text-sm">
              Open report
              <span className="material-symbols-outlined text-base">arrow_outward</span>
            </Link>
            <Link href={backHref} className="btn-pib-secondary !py-2 !px-4 !text-sm">
              Back to reports
            </Link>
          </div>
        </div>
      ) : (
        <CustomReportBuilder
          orgId={orgId}
          onSaved={(report) => {
            if (report.publicToken) setSavedToken(report.publicToken)
            else router.push(backHref)
          }}
        />
      )}
    </div>
  )
}
