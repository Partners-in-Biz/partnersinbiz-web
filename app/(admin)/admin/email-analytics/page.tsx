'use client'

// app/(admin)/admin/email-analytics/page.tsx
//
// Admin email analytics dashboard. Uses the selected org from OrgContext —
// admins must pick an org first (the OrgSwitcher in the topbar handles this).

export const dynamic = 'force-dynamic'

import { useOrg } from '@/lib/contexts/OrgContext'
import EmailAnalyticsDashboard from '@/components/email-analytics/EmailAnalyticsDashboard'

export default function AdminEmailAnalyticsPage() {
  const { selectedOrgId, orgName } = useOrg()

  if (!selectedOrgId) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold text-on-surface mb-2">Email Analytics</h1>
        <p className="text-on-surface-variant text-sm">
          Pick an organisation from the topbar to see its email analytics.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="px-6 pt-6 text-xs text-on-surface-variant">
        Viewing: <span className="text-on-surface font-medium">{orgName || selectedOrgId}</span>
      </div>
      <EmailAnalyticsDashboard orgId={selectedOrgId} isAdmin />
    </div>
  )
}
