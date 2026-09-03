'use client'
export const dynamic = 'force-dynamic'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { scopeFromSearchParams, scopedPortalPath } from '@/lib/portal/scoped-routing'
import { CustomReportBuilder } from '@/components/reports/CustomReportBuilder'
import { Icon, ButtonLink } from '@/components/studio'
import { PageHeader } from '@/components/ui/AppFoundation'

export default function NewCustomReport() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const routeScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const orgId = routeScope.orgId ?? null
  const backHref = useMemo(() => scopedPortalPath('/portal/reports', routeScope), [routeScope])
  const [savedToken, setSavedToken] = useState<string | null>(null)

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Custom report"
        title="Report builder."
        description="Assemble a report from sections: text, metrics, charts, tables and page breaks. Snapshot sections pull live numbers for the period."
        actions={(
          <ButtonLink href={backHref} variant="secondary" size="sm">
            <Icon name="arrow_back" />
            Back to reports
          </ButtonLink>
        )}
      />

      {savedToken ? (
        <div className="st-panel !p-6 text-center space-y-4">
          <Icon name="check_circle" />
          <h2 className="text-2xl">Report generated.</h2>
          <div className="flex items-center justify-center gap-3">
            <Link href={`/reports/${savedToken}`} target="_blank" className="st-btn st-btn--primary !py-2 !px-4 !text-sm">
              Open report
              <Icon name="arrow_outward" />
            </Link>
            <Link href={backHref} className="st-btn st-btn--secondary !py-2 !px-4 !text-sm">
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
