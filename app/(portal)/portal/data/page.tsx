'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'

export default function PortalData() {
  const today = new Date().toISOString().slice(0, 10)
  const ninetyAgo = (() => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - 90); return d.toISOString().slice(0, 10)
  })()
  const [from, setFrom] = useState(ninetyAgo)
  const [to, setTo] = useState(today)

  function dl(format: 'csv' | 'json') {
    const url = `/api/v1/portal/data-export?format=${format}&from=${from}&to=${to}`
    window.location.href = url
  }

  return (
    <div className="space-y-10 max-w-3xl">
      <header>
        <p className="eyebrow">Yours, no lock-in</p>
        <h1 className="pib-page-title mt-2">Your data</h1>
        <p className="pib-page-sub">
          Every metric we record about your business — yours to download, any time, in your format.
        </p>
      </header>

      <div className="bento-card !p-7 space-y-6">
        <div>
          <p className="eyebrow">Date range</p>
          <div className="grid grid-cols-2 gap-3 mt-3">
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
            <button onClick={() => dl('csv')} className="btn-pib-accent !py-2 !px-4 !text-sm">
              <span className="material-symbols-outlined text-base" aria-hidden="true">
                download
              </span>
              Download CSV
            </button>
            <button onClick={() => dl('json')} className="btn-pib-secondary !py-2 !px-4 !text-sm">
              <span className="material-symbols-outlined text-base" aria-hidden="true">
                code
              </span>
              Download JSON
            </button>
          </div>
        </div>
      </div>

      <div className="bento-card !p-7">
        <p className="eyebrow">What&rsquo;s in the export</p>
        <ul className="mt-4 space-y-2.5 text-sm text-[var(--color-pib-text)] leading-relaxed">
          <li className="flex gap-2">
            <span className="text-[var(--color-pib-accent)] mt-0.5">→</span>
            Daily metric rows from every connected source — RevenueCat, AdSense, AdMob, App Store Connect, Play Console, Google Ads, GA4.
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--color-pib-accent)] mt-0.5">→</span>
            Original currency + ZAR-converted value (FX rate at row&rsquo;s date).
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--color-pib-accent)] mt-0.5">→</span>
            Optional breakdown by ad unit, country, source/medium, or app.
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--color-pib-accent)] mt-0.5">→</span>
            Every row carries the date, property, source, metric kind, and raw provider payload (in JSON exports).
          </li>
        </ul>
      </div>
    </div>
  )
}
