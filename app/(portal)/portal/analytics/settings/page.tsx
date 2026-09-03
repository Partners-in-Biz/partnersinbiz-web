'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalyticsNav } from '@/components/admin/AnalyticsNav'
import { AnalyticsPropertyPicker } from '@/components/admin/AnalyticsPropertyPicker'
import { KpiCard, CopyButton } from '@/components/analytics/Primitives'
import { Icon } from '@/components/studio'
import { PageHeader, EmptyState } from '@/components/ui/AppFoundation'

interface VerifyData {
  propertyId: string
  ingestKey: string
  domain: string
  received: boolean
  lastEventAt: string | null
  last24h: number
}

function fmtDate(iso: string | null): string {
  if (!iso) return ' - '
  const d = new Date(iso)
  return isNaN(d.getTime()) ? ' - ' : d.toLocaleString()
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
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6" data-module-accent="violet">
      <AnalyticsNav active="settings" propertyId={propertyId} />
      <PageHeader
        eyebrow="Analytics · Settings"
        title="Install &amp; Settings."
      />

      <div className="st-panel space-y-4">
        <AnalyticsPropertyPicker value={propertyId} onChange={setPropertyId} />
      </div>

      {!propertyId && (
        <EmptyState title="Select a client and property to view installation instructions." />
      )}

      {propertyId && loading && <div className="pib-skeleton h-24" />}

      {propertyId && !loading && data && (
        <>
          <div className="st-panel space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Icon name="code" />
                <h2 className="pib-label mb-0">Script tag (recommended)</h2>
              </div>
              <CopyButton text={scriptCode} label="Copy" />
            </div>
            <pre className="bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded-lg p-3 text-xs text-[var(--color-pib-text)] overflow-x-auto font-mono whitespace-pre">{scriptCode}</pre>

            <div className="flex items-center justify-between gap-3 pt-2">
              <h2 className="pib-label mb-0">npm package</h2>
              <CopyButton text={npmCode} label="Copy" />
            </div>
            <pre className="bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded-lg p-3 text-xs text-[var(--color-pib-text)] overflow-x-auto font-mono whitespace-pre">{npmCode}</pre>

            <p className="text-xs text-[var(--color-pib-text-muted)]">
              Property ID <span className="font-mono text-[var(--color-pib-text)]">{data.propertyId}</span>
              {data.domain && <> · Domain <span className="font-mono text-[var(--color-pib-text)]">{data.domain}</span></>}
            </p>
          </div>

          <div className="st-panel space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Icon name="verified" />
                <h2 className="pib-label mb-0">Verification</h2>
              </div>
              <button name="page-action-35" type="button" onClick={load} className="st-btn st-btn--secondary text-xs px-3 py-1.5">
                Re-check
              </button>
            </div>

            {data.received ? (
              <>
                <span className="pib-pill pib-pill-success">
                  <span className="pib-status-dot pib-status-dot-success" />
                  Events received
                </span>
                <div className="grid grid-cols-2 gap-4">
                  <KpiCard label="Last event" value={fmtDate(data.lastEventAt)} accent />
                  <KpiCard label="Events (last 24h)" value={data.last24h.toLocaleString()} />
                </div>
              </>
            ) : (
              <>
                <span className="pib-pill pib-pill-warn">
                  <span className="pib-status-dot pib-status-dot-warn" />
                  No events received yet
                </span>
                <p className="text-sm text-[var(--color-pib-text-muted)]">
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
