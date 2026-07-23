'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { OrgSwitcher } from './OrgSwitcher'
// import GlobalSearch from './GlobalSearch'
import { useOrg } from '@/lib/contexts/OrgContext'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import { OPERATOR_NAV, workspaceNav, type NavItem } from './navConfig'
import { PortalViewSwitch } from './PortalViewSwitch'

const WORKSPACE_GROUP_LABELS: Record<NonNullable<NavItem['group']>, string> = {
  work: 'Workspace',
  data: 'Insights',
  comms: 'Account',
}

const OPERATOR_GROUP_LABELS: Record<NonNullable<NavItem['group']>, string> = {
  work: 'Platform',
  data: 'Growth',
  comms: 'Operations',
}

// ── Sidebar nav item ───────────────────────────────────────────────────────

function isItemActive(item: NavItem, pathname: string) {
  if (pathname === item.href || pathname.startsWith(item.href + '/')) return true
  if (item.children?.some((child) => pathname === child.href || pathname.startsWith(child.href + '/'))) return true
  return item.activePatterns?.some((pattern) => pathname === pattern || pathname.startsWith(pattern + '/')) ?? false
}

function NavLink({ item, pathname, collapsed }: { item: NavItem; pathname: string; collapsed?: boolean }) {
  const isActive = isItemActive(item, pathname)
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      data-active={isActive ? 'true' : undefined}
      className={[
        'pib-nav-item',
        collapsed ? 'justify-center !px-0' : '',
        isActive
          ? '!bg-[var(--color-pib-cyan-soft)] !text-[#5EEAD4]'
          : '',
      ].join(' ')}
    >
      <span
        className={[
          'material-symbols-outlined text-[18px] shrink-0',
          isActive ? 'text-[var(--color-pib-cyan)]' : 'opacity-70',
        ].join(' ')}
      >
        {item.icon}
      </span>
      {!collapsed && <span className="font-medium">{item.label}</span>}
    </Link>
  )
}

// ── Main sidebar ───────────────────────────────────────────────────────────

interface AdminSidebarProps {
  open?: boolean
  onClose?: () => void
  collapsed?: boolean
  onToggleCollapsed?: () => void
}

export function AdminSidebar({ open = false, onClose, collapsed = false, onToggleCollapsed }: AdminSidebarProps) {
  const pathname = usePathname()
  const { selectedOrgId, orgs } = useOrg()

  const routeOrgSlug = pathname.match(/^\/admin\/org\/([^/]+)/)?.[1]
  const routeOrg = routeOrgSlug ? orgs.find((o) => o.slug === routeOrgSlug) : undefined
  const selectedOrg = routeOrg ?? orgs.find((o) => o.id === selectedOrgId)
  const workspaceSlug = routeOrgSlug ?? selectedOrg?.slug
  const isWorkspaceMode = !!workspaceSlug
  const isPlatformWorkspace = selectedOrg?.type === 'platform_owner' || selectedOrg?.id === PIB_PLATFORM_ORG_ID
  const workspaceLabel = isPlatformWorkspace ? 'Platform admin' : 'Org admin'

  const navItems = isWorkspaceMode ? workspaceNav(workspaceSlug) : OPERATOR_NAV
  const groupedNav = (['work', 'data', 'comms'] as const).map((group) => ({
    group,
    items: navItems.filter((item) => item.group === group),
  })).filter(({ items }) => items.length > 0)
  const groupLabels = isWorkspaceMode ? WORKSPACE_GROUP_LABELS : OPERATOR_GROUP_LABELS
  const navContent = collapsed
    ? navItems.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
      ))
    : groupedNav.map(({ group, items }) => (
        <div key={group} className="space-y-0.5 pb-2 last:pb-0">
          <p className="eyebrow !text-[10px] px-2 mb-1">{groupLabels[group]}</p>
          {items.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </div>
      ))

  useEffect(() => {
    onClose?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const isMobile = window.matchMedia('(max-width: 767px)').matches
    if (open && isMobile) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [open])

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/70 backdrop-blur-sm transition-opacity duration-300 md:hidden ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      <aside
        data-module-accent="cyan"
        className={[
          'shrink-0 flex flex-col border-r border-[var(--pib-fx-line,var(--color-pib-line))] bg-[var(--color-sidebar)] overflow-hidden',
          'md:h-screen md:sticky md:top-0 md:z-auto',
          'fixed top-0 left-0 h-full z-50 transition-all duration-300 ease-in-out',
          collapsed ? 'w-14' : 'w-60',
          open ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        ].join(' ')}
      >
        {/* Brand */}
        <div
          className={[
            'pib-glass-bar shrink-0 !min-h-0 border-b border-[var(--pib-fx-line,var(--color-pib-line))]',
            collapsed ? 'h-11 justify-center !px-0' : 'h-11 gap-2 !px-3.5',
          ].join(' ')}
        >
          <Image src="/pib-logo-512.png" alt="Partners in Biz" width={22} height={22} className="rounded-md object-contain shrink-0" />
          {!collapsed && (
            <>
              <div className="flex flex-col min-w-0">
                <span className="font-display text-sm leading-none">Partners in Biz</span>
                {isWorkspaceMode && selectedOrg?.name && (
                  <span className="text-[10px] text-[var(--color-pib-text-muted)] truncate leading-tight mt-0.5">
                    {selectedOrg.name}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Collapse and mode switch controls */}
        <div className="hidden md:flex items-center justify-between h-8 border-b border-[var(--pib-fx-line,var(--color-pib-line))] shrink-0 px-0.5">
          <button
            onClick={onToggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={[
              'flex h-8 items-center justify-center rounded-md text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.04] transition-colors',
              collapsed ? 'w-full' : 'w-8',
            ].join(' ')}
          >
            <span className="material-symbols-outlined text-[16px]">
              {collapsed ? 'chevron_right' : 'chevron_left'}
            </span>
          </button>
          {!collapsed && isWorkspaceMode && selectedOrg?.id && (
            <PortalViewSwitch orgId={selectedOrg.id} iconOnly />
          )}
        </div>

        {!collapsed && isWorkspaceMode && selectedOrg?.id && (
          <div className="md:hidden border-b border-[var(--pib-fx-line,var(--color-pib-line))] shrink-0">
            <PortalViewSwitch orgId={selectedOrg.id} />
          </div>
        )}

        {collapsed && isWorkspaceMode && selectedOrg?.id && (
          <PortalViewSwitch orgId={selectedOrg.id} collapsed iconOnly />
        )}

        {/* Search - temporarily hidden while behavior is being revisited.
        {!collapsed && (
          <div className="px-3 pt-4 pb-3">
            <GlobalSearch />
          </div>
        )}
        */}

        {/* Org Switcher */}
        {!collapsed && (
          <div className="border-t border-[var(--pib-fx-line,var(--color-pib-line))] py-2.5 shrink-0">
            <p className="eyebrow !text-[9px] px-3.5 mb-1.5">Context</p>
            <OrgSwitcher />
          </div>
        )}

        {/* Navigation */}
        {!collapsed && (
          <div className="px-3 pt-2 pb-0.5 shrink-0">
            <p className="eyebrow !text-[9px] px-1.5 mb-1.5">{isWorkspaceMode ? `${workspaceLabel} navigation` : 'Navigation'}</p>
          </div>
        )}
        <nav className={['flex-1 min-h-0 overflow-y-auto space-y-0.5', collapsed ? 'px-1.5 pt-2' : 'px-2.5 pb-3'].join(' ')}>
          {navContent}
        </nav>
      </aside>
    </>
  )
}
