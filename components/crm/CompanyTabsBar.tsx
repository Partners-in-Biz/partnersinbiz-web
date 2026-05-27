'use client'

import { PageTabs } from '@/components/ui/AppFoundation'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CompanyTab = 'overview' | 'contacts' | 'deals' | 'quotes' | 'invoices' | 'activity'

export const COMPANY_TABS: { key: CompanyTab; label: string; icon: string }[] = [
  { key: 'overview',  label: 'Overview',  icon: 'info' },
  { key: 'contacts',  label: 'Contacts',  icon: 'person' },
  { key: 'deals',     label: 'Deals',     icon: 'monetization_on' },
  { key: 'quotes',    label: 'Quotes',    icon: 'request_quote' },
  { key: 'invoices',  label: 'Invoices',  icon: 'receipt_long' },
  { key: 'activity',  label: 'Activity',  icon: 'history' },
]

export interface CompanyTabsBarProps {
  activeTab: string
  onChange: (tab: string) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CompanyTabsBar({ activeTab, onChange }: CompanyTabsBarProps) {
  return (
    <PageTabs
      ariaLabel="Company detail tabs"
      value={activeTab}
      onValueChange={onChange}
      tabs={COMPANY_TABS.map((tab) => ({ label: tab.label, value: tab.key, icon: tab.icon }))}
    />
  )
}
