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
import { Icon } from '@/components/studio'

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
        'pib-nav-item relative min-h-11',
        collapsed ? 'justify-center px-0' : '',
      ].filter(Boolean).join(' ')}
    >
      <Icon name={item.icon} className={isActive ? 'text-[var(--sc-accent)]' : 'opacity-70'} />
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
          <p className="sc-tiny px-2 mb-1 text-[var(--sc-ink-soft)]">{groupLabels[group]}</p>
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
        className={`fixed inset-0 z-40 bg-black/70 transition-opacity duration-200 md:hidden ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      <aside
        className={[
          'shrink-0 flex flex-col border-r border-[var(--sc-line)] bg-[var(--sc-surface)] overflow-hidden',
          'md:h-screen md:sticky md:top-0 md:z-auto',
          'fixed top-0 left-0 h-full z-50 transition-all duration-200 ease-in-out',
          collapsed ? 'w-14' : 'w-60',
          open ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        ].join(' ')}
      >
        {/* Brand */}
        <div
          className={[
            'shrink-0 flex items-center border-b border-[var(--sc-line)]',
            collapsed ? 'h-14 justify-center px-0' : 'h-14 gap-2 px-3.5',
          ].join(' ')}
        >
          <Image src="/pib-logo-512.png" alt="Partners in Biz" width={22} height={22} className="rounded object-contain shrink-0" />
          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <span className="sc-tiny text-[var(--sc-ink)]">Partners in Biz</span>
              {isWorkspaceMode && selectedOrg?.name && (
                <span className="text-[10px] text-[var(--sc-ink-soft)] truncate leading-tight mt-0.5">
                  {selectedOrg.name}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Collapse and mode switch controls */}
        <div className="hidden md:flex items-center justify-between min-h-11 border-b border-[var(--sc-line)] shrink-0 px-0.5">
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={[
              'flex min-h-11 min-w-11 items-center justify-center text-[var(--sc-ink-soft)] hover:text-[var(--sc-ink)] hover:bg-black/[0.05] transition-colors',
              collapsed ? 'w-full' : 'w-11',
            ].join(' ')}
          >
            <Icon name={collapsed ? 'chevron_right' : 'chevron_left'} />
          </button>
          {!collapsed && isWorkspaceMode && selectedOrg?.id && (
            <PortalViewSwitch orgId={selectedOrg.id} iconOnly />
          )}
        </div>

        {!collapsed && isWorkspaceMode && selectedOrg?.id && (
          <div className="md:hidden border-b border-[var(--sc-line)] shrink-0">
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
          <div className="border-t border-[var(--sc-line)] py-2.5 shrink-0">
            <p className="sc-tiny px-3.5 mb-1.5 text-[var(--sc-ink-soft)]">Context</p>
            <OrgSwitcher />
          </div>
        )}

        {/* Navigation */}
        {!collapsed && (
          <div className="px-3 pt-2 pb-0.5 shrink-0">
            <p className="sc-tiny px-1.5 mb-1.5 text-[var(--sc-ink-soft)]">
              {isWorkspaceMode ? `${workspaceLabel} navigation` : 'Navigation'}
            </p>
          </div>
        )}
        <nav className={['flex-1 min-h-0 overflow-y-auto space-y-0.5', collapsed ? 'px-1.5 pt-2' : 'px-2.5 pb-3'].join(' ')}>
          {navContent}
        </nav>
      </aside>
    </>
  )
}
