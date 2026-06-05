'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
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
    <div className="space-y-10 max-w-5xl">
      <header>
        <p className="eyebrow">CRM data ops</p>
        <h1 className="pib-page-title mt-2">Data export command center</h1>
        <p className="pib-page-sub">
          Pull a clean, company-scoped backup of the metrics and raw payloads your team relies on for board packs, BI, and CRM audits.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Workspace', workspaceLabel],
          ['Default window', '90 days'],
          ['Formats', 'CSV + JSON'],
          ['Use case', 'CRM-ready backup'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-[var(--color-pib-border)] bg-white/80 p-4 shadow-sm">
            <p className="eyebrow">{label}</p>
            <p className="mt-2 text-base font-semibold text-[var(--color-pib-text)]">{value}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <div className="bento-card !p-7 space-y-6">
          <div>
            <p className="eyebrow">Date range</p>
            <div className="grid grid-cols-1 gap-3 mt-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs text-[var(--color-pib-text-muted)]">From</span>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  max={to}
                  className="pib-input mt-1.5"
                />
              </label>
              <label className="block">
                <span className="text-xs text-[var(--color-pib-text-muted)]">To</span>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  max={today}
                  className="pib-input mt-1.5"
                />
              </label>
            </div>
          </div>

          <div>
            <p className="eyebrow">Export format</p>
            <div className="flex gap-3 mt-3 flex-wrap">
              <a href={exportUrl('csv')} role="button" className="btn-pib-accent !py-2 !px-4 !text-sm">
                <span className="material-symbols-outlined text-base" aria-hidden="true">
                  download
                </span>
                Download CSV
              </a>
              <a href={exportUrl('json')} role="button" className="btn-pib-secondary !py-2 !px-4 !text-sm">
                <span className="material-symbols-outlined text-base" aria-hidden="true">
                  code
                </span>
                Download JSON
              </a>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">
              Exports are locked to the selected workspace before the file is generated.
            </p>
          </div>
        </div>

        <div className="bento-card !p-7">
          <p className="eyebrow">What&rsquo;s in the export</p>
          <ul className="mt-4 space-y-2.5 text-sm text-[var(--color-pib-text)] leading-relaxed">
            {[
              'Daily metric rows from every connected source: RevenueCat, AdSense, AdMob, App Store Connect, Play Console, Google Ads, and GA4.',
              'Original currency plus ZAR-converted value using the FX rate at the row date.',
              'Optional breakdown by ad unit, country, source or medium, app, and property.',
              'Every JSON row includes the date, property, source, metric kind, and raw provider payload.',
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <span className="material-symbols-outlined mt-0.5 text-base text-[var(--color-pib-accent)]" aria-hidden="true">
                  check_circle
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
