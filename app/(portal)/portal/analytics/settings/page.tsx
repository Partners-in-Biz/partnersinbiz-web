'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { KpiCard, CopyButton } from '@/components/analytics/Primitives'

interface VerifyData {
  propertyId: string
  ingestKey: string
  domain: string
  received: boolean
  lastEventAt: string | null
  last24h: number
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function scriptSnippet(ingestKey: string, propertyId: string): string {
  return `<script type="module">
  import { init } from 'https://app.partnersinbiz.online/sdk/analytics.js'
  init({ ingestKey: '${ingestKey}', propertyId: '${propertyId}' })
</script>`
}

function npmSnippet(ingestKey: string, propertyId: string): string {
  return `import { init } from '@partnersinbiz/analytics-js'
init({ ingestKey: '${ingestKey}', propertyId: '${propertyId}' })`
}

export default function AnalyticsSettingsPage() {
  const sp = useSearchParams()
  const [propertyId, setPropertyId] = useState(sp?.get('propertyId') ?? '')
  const [data, setData] = useState<VerifyData | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!propertyId) return
    setLoading(true)
    try {
      const qs = new URLSearchParams({ propertyId })
      const res = await fetch(`/api/v1/analytics/verify?${qs}`)
      const body = await res.json()
      setData(res.ok ? (body.data ?? body) : null)
    } catch { setData(null) } finally { setLoading(false) }
  }, [propertyId])

  useEffect(() => { load() }, [load])

  const scriptCode = useMemo(
    () => (data ? scriptSnippet(data.ingestKey, data.propertyId) : ''),
    [data],
  )
  const npmCode = useMemo(
    () => (data ? npmSnippet(data.ingestKey, data.propertyId) : ''),
    [data],
  )

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <AnalyticsNav active="settings" propertyId={propertyId} />
      <h1 className="text-xl font-headline font-bold text-on-surface">Install &amp; Settings</h1>

      <div className="pib-card p-4 space-y-3">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
      </div>

      {!propertyId && (
        <div className="pib-card p-8 text-center text-on-surface-variant text-sm">
          Select a client and property to view installation instructions.
        </div>
      )}

      {propertyId && loading && <div className="pib-skeleton h-24 rounded-lg" />}

      {propertyId && !loading && data && (
        <>
          <div className="pib-card p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-label font-semibold text-on-surface">Script tag (recommended)</h2>
              <CopyButton text={scriptCode} label="Copy" />
            </div>
            <pre className="bg-[var(--color-surface-container)] rounded-lg p-3 text-xs text-on-surface overflow-x-auto font-mono whitespace-pre">{scriptCode}</pre>

            <div className="flex items-center justify-between gap-3 pt-2">
              <h2 className="text-sm font-label font-semibold text-on-surface">npm package</h2>
              <CopyButton text={npmCode} label="Copy" />
            </div>
            <pre className="bg-[var(--color-surface-container)] rounded-lg p-3 text-xs text-on-surface overflow-x-auto font-mono whitespace-pre">{npmCode}</pre>

            <p className="text-xs text-on-surface-variant">
              Property ID <span className="font-mono text-on-surface">{data.propertyId}</span>
              {data.domain && <> · Domain <span className="font-mono text-on-surface">{data.domain}</span></>}
            </p>
          </div>

          <div className="pib-card p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-label font-semibold text-on-surface">Verification</h2>
              <button type="button" onClick={load} className="pib-btn-secondary text-xs px-3 py-1.5">
                Re-check
              </button>
            </div>

            {data.received ? (
              <>
                <span className="inline-block text-xs px-2.5 py-1 rounded-full bg-emerald-400/15 text-emerald-400 font-medium">
                  Events received
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <KpiCard label="Last event" value={fmtDate(data.lastEventAt)} accent />
                  <KpiCard label="Events (last 24h)" value={data.last24h.toLocaleString()} />
                </div>
              </>
            ) : (
              <>
                <span className="inline-block text-xs px-2.5 py-1 rounded-full bg-amber-400/15 text-amber-400 font-medium">
                  No events received yet
                </span>
                <p className="text-sm text-on-surface-variant">
                  Add the install snippet above to your site, then load a page and click Re-check.
                  Events usually appear within a few seconds.
                </p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
