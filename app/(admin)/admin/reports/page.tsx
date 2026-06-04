// app/(admin)/admin/reports/page.tsx — admin reports list

'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { ReportsWorkspace, type ReportsWorkspaceReport } from '@/components/reports/ReportsWorkspace'

interface Org {
  id: string
  name: string
  slug?: string
}

interface PropertyOption {
  id: string
  name: string
  domain: string
}

interface Report extends ReportsWorkspaceReport {
  id: string
  orgId: string
  type: 'monthly' | 'quarterly' | 'ad_hoc' | 'launch_review'
  period: { start: string; end: string; tz: string }
  status: 'draft' | 'rendered' | 'sent' | 'archived'
  publicToken: string | null
  brand: { orgName: string }
  kpis: { total_revenue: number; mrr: number; deltas: { total_revenue: number | null } }
  createdAt: { _seconds: number } | null
  sentAt: { _seconds: number } | null
}

export default function AdminReportsPage() {
  const [orgs, setOrgs] = useState<Org[]>([])
  const [orgId, setOrgId] = useState<string>('')
  const [propertyId, setPropertyId] = useState<string>('')
  const [properties, setProperties] = useState<PropertyOption[]>([])
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)

  // Load orgs once on mount.
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const requestedOrgId = searchParams.get('orgId')
    const requestedOrgSlug = searchParams.get('orgSlug')
    ;(async () => {
      try {
        const r = await fetch('/api/v1/organizations')
        const data = await r.json()
        const fetched: Org[] = (data.data ?? data.organizations ?? data.orgs ?? []) as Org[]
        setOrgs(fetched)
        const scopedOrg = requestedOrgId
          ? fetched.find((o) => o.id === requestedOrgId)
          : requestedOrgSlug
            ? fetched.find((o) => (o.slug ?? slugify(o.name)) === requestedOrgSlug)
            : null
        if (scopedOrg) {
          setOrgId(scopedOrg.id)
        } else if (fetched.length > 0) {
          setOrgId(fetched[0].id)
        }
      } catch {
        setOrgs([])
      }
    })()
  }, [])

  function slugify(value: string) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  const loadReports = useCallback(async (id: string) => {
    if (!id) return
    setLoading(true)
    try {
      const r = await fetch(`/api/v1/reports?orgId=${encodeURIComponent(id)}`)
      const data = await r.json()
      setReports(data.reports ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (orgId) loadReports(orgId)
  }, [orgId, loadReports])

  useEffect(() => {
    if (!orgId) {
      setProperties([])
      setPropertyId('')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/v1/properties?${new URLSearchParams({ orgId })}`)
        const data = await r.json()
        if (!cancelled) setProperties((data.data ?? []) as PropertyOption[])
      } catch {
        if (!cancelled) setProperties([])
      }
    })()
    return () => { cancelled = true }
  }, [orgId])

  async function generateNow() {
    if (!orgId) return
    setGenerating(true)
    try {
      const r = await fetch('/api/v1/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, propertyId: propertyId || undefined, type: 'monthly' }),
      })
      const data = await r.json()
      if (data.ok) {
        setFlash({ kind: 'ok', msg: 'Report generated.' })
        await loadReports(orgId)
      } else {
        setFlash({ kind: 'error', msg: data.error || 'generate failed' })
      }
    } finally {
      setGenerating(false)
    }
  }

  async function sendReport(id: string) {
    const to = prompt('Send to (comma-separated emails):')
    if (!to) return
    setBusy(id)
    try {
      const recipients = to.split(',').map((s) => s.trim()).filter(Boolean)
      const r = await fetch(`/api/v1/reports/${encodeURIComponent(id)}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: recipients }),
      })
      const data = await r.json()
      if (data.ok) {
        setFlash({ kind: 'ok', msg: `Sent to ${recipients.length} recipient(s).` })
        await loadReports(orgId)
      } else {
        setFlash({ kind: 'error', msg: data.error || 'send failed' })
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl font-display">Reports</h1>
          <p className="mt-1 text-sm text-white/60 max-w-xl">
            Branded monthly performance reports for clients. Generated from the unified metrics fact table — every connected source rolls up here.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={orgId}
            onChange={(e) => {
              setOrgId(e.target.value)
              setPropertyId('')
            }}
            className="bg-white/[0.04] border border-white/10 rounded-full px-4 py-2 text-sm text-white"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id} className="bg-[#0A0A0B]">{o.name}</option>
            ))}
          </select>
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className="bg-white/[0.04] border border-white/10 rounded-full px-4 py-2 text-sm text-white"
          >
            <option value="" className="bg-[#0A0A0B]">All properties</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id} className="bg-[#0A0A0B]">
                {property.name} - {property.domain}
              </option>
            ))}
          </select>
          <button
            disabled={!orgId || generating}
            onClick={generateNow}
            className="px-4 py-2 text-sm rounded-full bg-white text-black font-medium hover:bg-[#F5A623] transition-colors disabled:opacity-60"
          >
            {generating ? 'Generating…' : 'Generate this month'}
          </button>
        </div>
      </header>

      {flash && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          flash.kind === 'ok'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
            : 'bg-red-500/10 border-red-500/30 text-red-200'
        }`}>
          {flash.msg}
          <button onClick={() => setFlash(null)} className="float-right text-xs opacity-60 hover:opacity-100">dismiss</button>
        </div>
      )}

      <ReportsWorkspace
        reports={reports}
        loading={loading}
        mode="admin"
        busyReportId={busy}
        onSendReport={sendReport}
        emptyMessage="Press Generate this month to create the first report."
      />
    </div>
  )
}
