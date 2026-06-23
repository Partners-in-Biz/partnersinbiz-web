'use client'
export const dynamic = 'force-dynamic'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader, PageTabs, StatusPill, type PageTab } from '@/components/ui/AppFoundation'
import { apiGet, type OrgDetail } from '@/components/admin/orgs/OrgDetailApi'
import { OrgDetailOverviewPanel } from '@/components/admin/orgs/OrgDetailOverviewPanel'
import { OrgBillingPanel } from '@/components/admin/orgs/OrgBillingPanel'
import { OrgTeamPanel } from '@/components/admin/orgs/OrgTeamPanel'
import { OrgActivityPanel } from '@/components/admin/orgs/OrgActivityPanel'
import { OrgFeatureFlagsPanel } from '@/components/admin/orgs/OrgFeatureFlagsPanel'
import { OrgHealthPanel } from '@/components/admin/orgs/OrgHealthPanel'
import { OrgAnalyticsExportPanel } from '@/components/admin/orgs/OrgAnalyticsExportPanel'

type TabValue = 'overview' | 'billing' | 'team' | 'activity' | 'flags' | 'health' | 'export'

const TABS: PageTab[] = [
  { value: 'overview', label: 'Overview', icon: 'dashboard' },
  { value: 'billing', label: 'Billing', icon: 'payments' },
  { value: 'team', label: 'Team', icon: 'group' },
  { value: 'activity', label: 'Activity', icon: 'history' },
  { value: 'flags', label: 'Feature flags', icon: 'flag' },
  { value: 'health', label: 'Health', icon: 'monitor_heart' },
  { value: 'export', label: 'Analytics export', icon: 'download' },
]

const STATUS_TONE: Record<string, 'success' | 'warn' | 'danger' | 'neutral'> = {
  active: 'success', suspended: 'danger', churned: 'neutral', trial: 'warn',
}

export default function AdminOrgDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const [tab, setTab] = useState<TabValue>('overview')
  const [org, setOrg] = useState<OrgDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    apiGet<OrgDetail>(`/api/v1/admin/org/${slug}`)
      .then((d) => { setOrg(d); setLoading(false) })
      .catch((e) => { setError(e.message); setLoading(false) })
  }, [slug])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href="/admin/organizations" className="inline-flex items-center gap-1 hover:text-on-surface">
            <span className="material-symbols-outlined text-[16px]">arrow_back</span> Organisations
          </Link>
        }
        title={org?.name ?? slug}
        description={org?.description || `Platform-admin control surface for ${slug}`}
        meta={
          org ? (
            <>
              <StatusPill tone={STATUS_TONE[org.status] ?? 'neutral'} dot>{org.status}</StatusPill>
              {org.devMode && <StatusPill tone="warn">dev mode</StatusPill>}
              {org.plan && <StatusPill tone="neutral">{org.plan}</StatusPill>}
              <span>/{org.slug}</span>
            </>
          ) : null
        }
        actions={
          org ? (
            <Link href={`/admin/org/${slug}/dashboard`} className="pib-btn-secondary">
              <span className="material-symbols-outlined text-[18px]">open_in_new</span> Open workspace
            </Link>
          ) : null
        }
        tabs={<PageTabs tabs={TABS} value={tab} onValueChange={(v) => setTab(v as TabValue)} ariaLabel="Org control tabs" />}
      />

      {error && <div className="pib-card text-sm text-red-400">{error}</div>}
      {loading && !org && <div className="pib-card text-sm text-on-surface-variant">Loading organisation…</div>}

      {org && (
        <>
          {tab === 'overview' && <OrgDetailOverviewPanel org={org} onChanged={load} />}
          {tab === 'billing' && <OrgBillingPanel slug={slug} />}
          {tab === 'team' && <OrgTeamPanel slug={slug} />}
          {tab === 'activity' && <OrgActivityPanel slug={slug} />}
          {tab === 'flags' && <OrgFeatureFlagsPanel slug={slug} />}
          {tab === 'health' && <OrgHealthPanel slug={slug} />}
          {tab === 'export' && <OrgAnalyticsExportPanel slug={slug} />}
        </>
      )}
    </div>
  )
}
