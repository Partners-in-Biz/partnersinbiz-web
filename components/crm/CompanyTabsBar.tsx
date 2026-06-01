'use client'

import { useEffect, useRef, useState } from 'react'
import { PageTabs } from '@/components/ui/AppFoundation'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CompanyTab =
  | 'overview'
  | 'contacts'
  | 'deals'
  | 'projects'
  | 'documents'
  | 'services'
  | 'relationships'
  | 'quotes'
  | 'invoices'
  | 'orders'
  | 'shipments'
  | 'inventory'
  | 'analytics'
  | 'activity'

export const COMPANY_TABS: { key: CompanyTab; label: string; icon: string }[] = [
  { key: 'overview',  label: 'Overview',  icon: 'info' },
  { key: 'contacts',  label: 'Contacts',  icon: 'person' },
  { key: 'deals',     label: 'Deals',     icon: 'monetization_on' },
  { key: 'projects',  label: 'Projects',  icon: 'folder_managed' },
  { key: 'documents', label: 'Documents', icon: 'description' },
  { key: 'services',  label: 'Services',  icon: 'workspaces' },
  { key: 'relationships', label: 'Relationships', icon: 'hub' },
  { key: 'quotes',    label: 'Quotes',    icon: 'request_quote' },
  { key: 'invoices',  label: 'Invoices',  icon: 'receipt_long' },
  { key: 'orders',    label: 'Orders',    icon: 'orders' },
  { key: 'shipments', label: 'Shipments', icon: 'local_shipping' },
  { key: 'inventory', label: 'Inventory', icon: 'inventory_2' },
  { key: 'analytics', label: 'Analytics', icon: 'monitoring' },
  { key: 'activity',  label: 'Activity',  icon: 'history' },
]

const PRIMARY_TAB_KEYS: CompanyTab[] = ['overview', 'contacts', 'deals', 'projects', 'documents']

const OVERFLOW_GROUPS: Array<{ label: string; tabs: CompanyTab[] }> = [
  { label: 'Commercial', tabs: ['quotes', 'invoices', 'orders'] },
  { label: 'Delivery', tabs: ['services', 'shipments', 'inventory'] },
  { label: 'Relationship', tabs: ['relationships', 'activity'] },
  { label: 'Insight', tabs: ['analytics'] },
]

const COMPANY_TAB_BY_KEY = new Map(COMPANY_TABS.map((tab) => [tab.key, tab]))

export interface CompanyTabsBarProps {
  activeTab: string
  onChange: (tab: string) => void
  counts?: Partial<Record<CompanyTab, number>>
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CompanyTabsBar({ activeTab, onChange, counts }: CompanyTabsBarProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement | null>(null)
  const activeOverflowTab = COMPANY_TAB_BY_KEY.get(activeTab as CompanyTab)
  const visibleKeys = new Set<CompanyTab>(PRIMARY_TAB_KEYS)
  if (activeOverflowTab && !visibleKeys.has(activeOverflowTab.key)) visibleKeys.add(activeOverflowTab.key)

  useEffect(() => {
    if (!moreOpen) return

    function onPointerDown(event: PointerEvent) {
      if (moreRef.current?.contains(event.target as Node)) return
      setMoreOpen(false)
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMoreOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [moreOpen])

  const visibleTabs = COMPANY_TABS.filter((tab) => visibleKeys.has(tab.key))

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <PageTabs
        ariaLabel="Company detail tabs"
        value={activeTab}
        onValueChange={onChange}
        tabs={visibleTabs.map((tab) => ({
          label: tab.label,
          value: tab.key,
          icon: tab.icon,
          badge: counts?.[tab.key] ? counts[tab.key] : undefined,
        }))}
      />

      <div ref={moreRef} className="relative">
        <button
          type="button"
          aria-label="More company sections"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          className="pib-tab"
          onClick={() => setMoreOpen((open) => !open)}
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">apps</span>
          <span>More</span>
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{moreOpen ? 'expand_less' : 'expand_more'}</span>
        </button>

        {moreOpen ? (
          <div
            role="menu"
            aria-label="More company sections"
            className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-2 shadow-2xl shadow-black/30"
          >
            {OVERFLOW_GROUPS.map((group) => {
              const groupTabs = group.tabs
                .flatMap((key) => {
                  const tab = COMPANY_TAB_BY_KEY.get(key)
                  if (!tab || visibleKeys.has(tab.key)) return []
                  return [tab]
                })

              if (groupTabs.length === 0) return null

              return (
                <div key={group.label} className="border-b border-[var(--color-pib-line)] py-2 last:border-b-0">
                  <p className="px-3 pb-1 text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">{group.label}</p>
                  <div className="grid gap-1">
                    {groupTabs.map((tab) => {
                      const selected = tab.key === activeTab
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          role="menuitemradio"
                          aria-checked={selected}
                          className={cn(
                            'flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/5 hover:text-[var(--color-pib-text)]',
                            selected && 'bg-white/10 text-[var(--color-pib-text)]',
                          )}
                          onClick={() => {
                            onChange(tab.key)
                            setMoreOpen(false)
                          }}
                        >
                          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{tab.icon}</span>
                          <span className="min-w-0 flex-1 truncate">{tab.label}</span>
                          {counts?.[tab.key] ? <span className="pib-tabs-badge">{counts[tab.key]}</span> : null}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
