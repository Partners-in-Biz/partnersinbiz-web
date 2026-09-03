'use client'

import Link from 'next/link'
import Image from 'next/image'
import { SettingsNav } from '@/components/settings/SettingsNav'
import { ThemedSelect } from '@/components/ui/ThemedSelect'

export interface PortalNavItem {
  href: string
  label: string
  icon: string
  group: 'work' | 'data' | 'comms'
  activePatterns?: string[]
}

export interface PortalWorkspaceOption {
  id: string
  name: string
}

export const PORTAL_NAV_GROUP_LABELS: Record<PortalNavItem['group'], string> = {
  work: 'Workspace',
  data: 'Insights',
  comms: 'Account',
}

export function isPortalNavActive(pathname: string, item: PortalNavItem) {
  const hrefPath = item.href.split('?')[0] ?? item.href
  if (pathname === hrefPath || pathname.startsWith(hrefPath + '/')) return true
  return item.activePatterns?.some((pattern) => pathname === pattern || pathname.startsWith(pattern + '/')) ?? false
}

export function PortalNavLink({
  item,
  pathname,
  collapsed,
}: {
  item: PortalNavItem
  pathname: string
  collapsed?: boolean
}) {
  const on = isPortalNavActive(pathname, item)
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      data-active={on ? 'true' : undefined}
      className={[
        'pib-nav-item relative w-full',
        collapsed ? 'justify-center px-0 min-h-9' : '',
      ].filter(Boolean).join(' ')}
    >
      <span className={['material-symbols-outlined text-[18px] shrink-0', on ? 'text-[var(--color-pib-accent)]' : 'opacity-70'].join(' ')}>
        {item.icon}
      </span>
      {!collapsed && <span className="font-medium flex-1 truncate">{item.label}</span>}
    </Link>
  )
}

export interface PortalSidebarProps {
  pathname: string
  collapsed: boolean
  drawerOpen: boolean
  onCloseDrawer: () => void
  onToggleCollapsed: () => void
  dashboardHref: string
  orgName: string
  portalWorkspaceLabel: string
  canOpenAdminView: boolean
  adminViewHref: string
  workspaceOptions: PortalWorkspaceOption[]
  activeOrgId: string
  workspaceSwitcherLocked: boolean
  onOrgSwitch: (orgId: string) => void
  navItems: PortalNavItem[]
  grouped: Array<{ group: PortalNavItem['group']; items: PortalNavItem[] }>
  profileName: string
  name: string
  email: string
  initials: string
  profileHref: string
  memberRole: string | null
  canAccessConfiguration: boolean
  onLogout: () => void
}

export function PortalSidebar({
  pathname,
  collapsed,
  drawerOpen,
  onCloseDrawer,
  onToggleCollapsed,
  dashboardHref,
  orgName,
  portalWorkspaceLabel,
  canOpenAdminView,
  adminViewHref,
  workspaceOptions,
  activeOrgId,
  workspaceSwitcherLocked,
  onOrgSwitch,
  navItems,
  grouped,
  profileName,
  name,
  email,
  initials,
  profileHref,
  memberRole,
  canAccessConfiguration,
  onLogout,
}: PortalSidebarProps) {
  return (
    <>
      {/* Mobile backdrop */}
      <div
        onClick={onCloseDrawer}
        className={`fixed inset-0 z-40 bg-black/70 backdrop-blur-sm transition-opacity duration-300 md:hidden ${
          drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside
        className={[
          'shrink-0 flex flex-col border-r border-[var(--color-pib-line)] bg-[var(--color-pib-bg)]',
          'fixed top-0 left-0 h-screen z-50 transition-all duration-300 ease-in-out',
          'md:sticky md:top-0 md:translate-x-0',
          collapsed ? 'w-14' : 'w-[232px]',
          drawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        ].join(' ')}
      >
        {/* Brand */}
        <Link
          href={dashboardHref}
          className={['flex items-center min-h-11 border-b border-[var(--color-pib-line)] shrink-0', collapsed ? 'justify-center px-0' : 'gap-2 px-3 py-2'].join(' ')}
        >
          <Image src="/pib-logo-512.png" alt="Partners in Biz" width={22} height={22} className="rounded-md object-contain shrink-0" />
          {!collapsed && (
            <>
              <div className="flex flex-col min-w-0">
                <span className="font-display text-sm leading-tight">Partners in Biz</span>
                {orgName && <span className="text-[10px] text-[var(--color-pib-text-muted)] truncate leading-tight mt-0.5">{orgName}</span>}
              </div>
              <span className="ml-auto pill !text-[10px] !py-0.5 !px-1.5 shrink-0">{portalWorkspaceLabel}</span>
            </>
          )}
        </Link>

        {/* Collapse and mode switch controls */}
        <div className="hidden md:flex items-center justify-between h-7 border-b border-[var(--color-pib-line)] shrink-0">
          <button
            onClick={onToggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={[
              'flex h-7 items-center justify-center text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors',
              collapsed ? 'w-full' : 'w-7 border-r border-[var(--color-pib-line)]',
            ].join(' ')}
          >
            <span className="material-symbols-outlined text-[16px]">
              {collapsed ? 'chevron_right' : 'chevron_left'}
            </span>
          </button>
          {!collapsed && canOpenAdminView && (
            <Link
              href={adminViewHref}
              title="Switch to admin view"
              aria-label="Switch to admin view"
              className="h-7 w-7 border-l border-[var(--color-pib-line)] flex items-center justify-center text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05] transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">person</span>
            </Link>
          )}
        </div>

        {!collapsed && canOpenAdminView && (
          <div className="md:hidden border-b border-[var(--color-pib-line)] shrink-0 px-2 py-2">
            <Link
              href={adminViewHref}
              title="Switch to admin view"
              aria-label="Switch to admin view"
              className="pib-nav-item min-h-11 w-full"
            >
              <span className="material-symbols-outlined text-[18px] shrink-0 opacity-70">person</span>
              <span className="font-medium">Admin view</span>
            </Link>
          </div>
        )}

        {collapsed && canOpenAdminView && (
          <div className="border-b border-[var(--color-pib-line)] shrink-0">
            <Link
              href={adminViewHref}
              title="Switch to admin view"
              aria-label="Switch to admin view"
              className="mx-auto my-1.5 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05] transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">person</span>
            </Link>
          </div>
        )}

        {/* Workspace switcher — compact, near the top like the admin context. */}
        {workspaceOptions.length > 0 && (
          <div className="border-b border-[var(--color-pib-line)] shrink-0">
            {collapsed ? (
              <button
                type="button"
                onClick={onToggleCollapsed}
                title={`Workspace: ${orgName || 'Current workspace'}`}
                className="mx-auto my-1.5 w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold transition-colors bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)] ring-1 ring-[var(--color-pib-accent)]/30"
              >
                {(orgName || workspaceOptions.find(org => org.id === activeOrgId)?.name || 'W')[0]?.toUpperCase() ?? 'W'}
              </button>
            ) : (
              <div className="px-2.5 py-2">
                <label htmlFor="portal-workspace-switcher" className="eyebrow !text-[10px] px-1 mb-1 block">
                  Workspace
                </label>
                <ThemedSelect
                  id="portal-workspace-switcher"
                  ariaLabel="Switch portal workspace"
                  value={activeOrgId}
                  options={workspaceOptions.map(org => ({ value: org.id, label: org.name }))}
                  onValueChange={onOrgSwitch}
                  disabled={workspaceSwitcherLocked}
                  className="w-full"
                  buttonClassName="w-full"
                  menuClassName="bg-[var(--color-pib-surface)] text-[var(--color-pib-text)]"
                />
              </div>
            )}
          </div>
        )}

        {/* Nav — settings mode replaces normal nav */}
        {pathname.startsWith('/portal/settings') ? (
          <SettingsNav
            name={profileName || name}
            email={email}
            initials={initials}
            role={memberRole}
            canAccessConfiguration={canAccessConfiguration}
            collapsed={collapsed}
          />
        ) : (
          <nav className={['flex-1 overflow-y-auto py-2.5', collapsed ? 'px-1.5 space-y-0.5' : 'px-2 space-y-3'].join(' ')}>
            {collapsed
              ? navItems.map(item => <PortalNavLink key={item.href} item={item} pathname={pathname} collapsed />)
              : grouped.map(({ group, items }) => (
                  <div key={group} className="space-y-0.5">
                    <p className="eyebrow !text-[10px] px-2 mb-1">{PORTAL_NAV_GROUP_LABELS[group]}</p>
                    {items.map(item => <PortalNavLink key={item.href} item={item} pathname={pathname} />)}
                  </div>
                ))
            }
          </nav>
        )}

        {/* User chip */}
        <div className="border-t border-[var(--color-pib-line)] p-2 shrink-0">
          {collapsed ? (
            <div className="flex flex-col items-center gap-1.5">
              <Link
                href={profileHref}
                title="My profile"
                className="w-7 h-7 rounded-full bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-line-strong)] flex items-center justify-center text-[11px] font-medium text-[var(--color-pib-accent-hover)] hover:ring-2 hover:ring-[var(--color-pib-accent)]/40 transition-all"
              >
                {initials || '·'}
              </Link>
              <button onClick={onLogout} title="Sign out" className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors p-1">
                <span className="material-symbols-outlined text-[18px]">logout</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-1.5 py-1 rounded-lg">
              <Link
                href={profileHref}
                title="My profile"
                className="w-7 h-7 rounded-full bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-line-strong)] flex items-center justify-center text-[11px] font-medium text-[var(--color-pib-accent-hover)] hover:ring-2 hover:ring-[var(--color-pib-accent)]/40 transition-all shrink-0"
              >
                {initials || '·'}
              </Link>
              <Link href={profileHref} className="flex-1 min-w-0 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--color-pib-accent)]/40">
                <p className="text-xs font-medium truncate">{profileName || name || 'Client'}</p>
                <p className="text-[10px] text-[var(--color-pib-text-muted)] truncate">{email}</p>
              </Link>
              <button
                onClick={onLogout}
                data-tip="Sign out"
                data-tip-side="right"
                aria-label="Sign out"
                className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors p-1"
              >
                <span className="material-symbols-outlined text-[18px]">logout</span>
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
