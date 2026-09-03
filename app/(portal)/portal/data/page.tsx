'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { PageHeader } from '@/components/ui/AppFoundation'
import { StatCard } from '@/components/ui/StatCard'
import { ButtonLink, Field, Icon, Input, Panel } from '@/components/studio'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function PortalData() {
  const searchParams = useSearchParams()
  const orgScope = scopeFromSearchParams(searchParams)
  const today = new Date().toISOString().slice(0, 10)
  const ninetyAgo = (() => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - 90); return d.toISOString().slice(0, 10)
  })()
  const [from, setFrom] = useState(ninetyAgo)
  const [to, setTo] = useState(today)
  const workspaceLabel = orgScope.sourceCompanyName ? `${orgScope.sourceCompanyName} workspace` : 'Active workspace'

  function exportUrl(format: 'csv' | 'json') {
    return scopedApiPath(`/api/v1/portal/data-export?format=${format}&from=${from}&to=${to}`, orgScope)
  }

  return (
    <div className="max-w-5xl space-y-8">
      <PageHeader
        eyebrow="CRM data ops"
        title="Data export command center."
        description="Pull a company-scoped backup of metrics and raw payloads for board packs, BI, and CRM audits."
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Workspace" value={workspaceLabel} />
        <StatCard label="Default window" value="90 days" />
        <StatCard label="Formats" value="CSV + JSON" />
        <StatCard label="Use case" value="CRM-ready backup" />
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <Panel className="space-y-8">
          <div className="space-y-4">
            <p className="sc-tiny">Date range</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="data-export-from" label="From">
                <Input
                  id="data-export-from"
                  aria-label="From"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  max={to}
                />
              </Field>
              <Field id="data-export-to" label="To">
                <Input
                  id="data-export-to"
                  aria-label="To"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  max={today}
                />
              </Field>
            </div>
          </div>

          <div className="space-y-4">
            <p className="sc-tiny">Export format</p>
            <div className="flex flex-wrap gap-2">
              <ButtonLink href={exportUrl('csv')} size="sm">
                <Icon name="download" />
                Download CSV
              </ButtonLink>
              <ButtonLink href={exportUrl('json')} variant="secondary" size="sm">
                <Icon name="code" />
                Download JSON
              </ButtonLink>
            </div>
            <p className="sc-body text-[0.875rem] text-[var(--sc-ink-soft)]">
              Exports are locked to the selected workspace before the file is generated.
            </p>
          </div>
        </Panel>

        <Panel>
          <p className="sc-tiny">What is in the export</p>
          <ul className="mt-4 space-y-2 sc-body text-[var(--sc-ink)]">
            {[
              'Daily metric rows from every connected source: RevenueCat, AdSense, AdMob, App Store Connect, Play Console, Google Ads, and GA4.',
              'Original currency plus ZAR-converted value using the FX rate at the row date.',
              'Optional breakdown by ad unit, country, source or medium, app, and property.',
              'Every JSON row includes the date, property, source, metric kind, and raw provider payload.',
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <Icon name="check_circle" className="mt-0.5 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  )
}
