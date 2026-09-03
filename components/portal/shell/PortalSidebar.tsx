'use client'

import Link from 'next/link'
import { SettingsNav } from '@/components/settings/SettingsNav'
import { ThemedSelect } from '@/components/ui/ThemedSelect'
import { Avatar, Icon } from '@/components/studio'

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
        'pib-nav-item relative inline-flex items-center gap-2 w-full min-h-11 px-2',
        collapsed ? 'justify-center !px-0' : '',
      ].filter(Boolean).join(' ')}
    >
      <Icon name={item.icon} className="shrink-0" />
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
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
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 md:hidden ${
          drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside
        className={[
          'shrink-0 flex flex-col border-r border-[var(--sc-line)] bg-[var(--sc-surface)] text-[var(--sc-ink)]',
          'fixed top-0 left-0 h-screen z-50 transition-[transform,width] duration-200 ease-out',
          'md:sticky md:top-0 md:translate-x-0',
          collapsed ? 'w-14' : 'w-[232px]',
          drawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        ].join(' ')}
      >
        {/* Brand — wordmark */}
        <Link
          href={dashboardHref}
          className={[
            'flex items-center min-h-11 border-b border-[var(--sc-line)] shrink-0',
            collapsed ? 'justify-center px-0' : 'gap-2 px-3 py-2',
          ].join(' ')}
        >
          {collapsed ? (
            <span className="sc-tiny" aria-label="Partners in Biz">PiB</span>
          ) : (
            <div className="flex flex-col min-w-0 gap-0.5">
              <span className="sc-tiny">Partners in Biz</span>
              {orgName ? (
                <span className="sc-tiny truncate text-[var(--sc-ink-soft)]">{orgName}</span>
              ) : null}
              <span className="sc-tiny text-[var(--sc-ink-soft)]">{portalWorkspaceLabel}</span>
            </div>
          )}
        </Link>

        {/* Collapse and mode switch controls */}
        <div className="hidden md:flex items-center justify-between min-h-11 border-b border-[var(--sc-line)] shrink-0">
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={[
              'flex min-h-11 items-center justify-center text-[var(--sc-ink-soft)] hover:text-[var(--sc-ink)] transition-colors',
              collapsed ? 'w-full' : 'w-11 border-r border-[var(--sc-line)]',
            ].join(' ')}
          >
            <Icon name={collapsed ? 'chevron_right' : 'chevron_left'} />
          </button>
          {!collapsed && canOpenAdminView && (
            <Link
              href={adminViewHref}
              title="Switch to admin view"
              aria-label="Switch to admin view"
              className="min-h-11 w-11 border-l border-[var(--sc-line)] flex items-center justify-center text-[var(--sc-ink-soft)] hover:text-[var(--sc-ink)] transition-colors"
            >
              <Icon name="person" />
            </Link>
          )}
        </div>

        {!collapsed && canOpenAdminView && (
          <div className="md:hidden border-b border-[var(--sc-line)] shrink-0 px-2 py-2">
            <Link
              href={adminViewHref}
              title="Switch to admin view"
              aria-label="Switch to admin view"
              className="pib-nav-item inline-flex items-center gap-2 min-h-11 w-full px-2"
            >
              <Icon name="person" className="shrink-0" />
              <span>Admin view</span>
            </Link>
          </div>
        )}

        {collapsed && canOpenAdminView && (
          <div className="border-b border-[var(--sc-line)] shrink-0">
            <Link
              href={adminViewHref}
              title="Switch to admin view"
              aria-label="Switch to admin view"
              className="mx-auto my-1 flex min-h-11 min-w-11 items-center justify-center text-[var(--sc-ink-soft)] hover:text-[var(--sc-ink)] transition-colors"
            >
              <Icon name="person" />
            </Link>
          </div>
        )}

        {/* Workspace switcher */}
        {workspaceOptions.length > 0 && (
          <div className="border-b border-[var(--sc-line)] shrink-0">
            {collapsed ? (
              <button
                type="button"
                onClick={onToggleCollapsed}
                title={`Workspace: ${orgName || 'Current workspace'}`}
                aria-label={`Workspace: ${orgName || 'Current workspace'}`}
                className="mx-auto my-1 flex min-h-11 min-w-11 items-center justify-center"
              >
                <Avatar
                  size="sm"
                  initials={(orgName || workspaceOptions.find(org => org.id === activeOrgId)?.name || 'W')[0]?.toUpperCase() ?? 'W'}
                />
              </button>
            ) : (
              <div className="px-2.5 py-2">
                <label htmlFor="portal-workspace-switcher" className="sc-tiny px-1 mb-1 block text-[var(--sc-ink-soft)]">
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
                    <p className="sc-tiny px-2 mb-1 text-[var(--sc-ink-soft)]">{PORTAL_NAV_GROUP_LABELS[group]}</p>
                    {items.map(item => <PortalNavLink key={item.href} item={item} pathname={pathname} />)}
                  </div>
                ))
            }
          </nav>
        )}

        {/* User chip */}
        <div className="border-t border-[var(--sc-line)] p-2 shrink-0">
          {collapsed ? (
            <div className="flex flex-col items-center gap-1">
              <Link
                href={profileHref}
                title="My profile"
                aria-label="My profile"
                className="flex min-h-11 min-w-11 items-center justify-center"
              >
                <Avatar size="sm" initials={initials || '·'} />
              </Link>
              <button
                type="button"
                onClick={onLogout}
                title="Sign out"
                aria-label="Sign out"
                className="flex min-h-11 min-w-11 items-center justify-center text-[var(--sc-ink-soft)] hover:text-[var(--sc-ink)] transition-colors"
              >
                <Icon name="logout" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-1.5 py-1">
              <Link href={profileHref} title="My profile" aria-label="My profile" className="shrink-0">
                <Avatar size="sm" initials={initials || '·'} />
              </Link>
              <Link href={profileHref} className="flex-1 min-w-0 rounded-[var(--st-radius)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-accent)] focus-visible:ring-offset-4">
                <p className="sc-body truncate text-[0.8125rem] text-[var(--sc-ink)]">{profileName || name || 'Client'}</p>
                <p className="sc-tiny truncate text-[var(--sc-ink-soft)]">{email}</p>
              </Link>
              <button
                type="button"
                onClick={onLogout}
                data-tip="Sign out"
                data-tip-side="right"
                aria-label="Sign out"
                className="flex min-h-11 min-w-11 items-center justify-center text-[var(--sc-ink-soft)] hover:text-[var(--sc-ink)] transition-colors"
              >
                <Icon name="logout" />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
