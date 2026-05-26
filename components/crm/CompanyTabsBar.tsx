'use client'

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
    <div
      className="flex items-center gap-0 border-b border-[var(--color-pib-line)]"
      role="tablist"
      aria-label="Company detail tabs"
    >
      {COMPANY_TABS.map((tab) => {
        const isActive = activeTab === tab.key
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={`cursor-pointer flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              isActive
                ? 'border-[var(--color-accent-v2)] text-[var(--color-accent-v2)]'
                : 'border-transparent text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
