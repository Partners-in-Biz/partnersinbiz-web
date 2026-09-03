'use client'

import { type ReactNode } from 'react'
import Link from 'next/link'
import { SupportDrawer } from '@/components/support/SupportDrawer'
import { NotificationBell } from '@/components/crm/NotificationBell'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { MessageDrawer } from '@/components/chat/MessageDrawer'
import { ThemedSelect } from '@/components/ui/ThemedSelect'
import { Avatar, Crumbs, Icon } from '@/components/studio'
import type { ContextReferenceSeed } from '@/lib/context-references/types'
import {
  isPortalNavActive,
  type PortalNavItem,
  type PortalWorkspaceOption,
} from './PortalSidebar'

const TOPBAR_H = 'h-[calc(var(--sc-u)*14)]'

function iconBtnClass(extra = '') {
  return [
    'inline-flex min-h-11 min-w-11 items-center justify-center text-[var(--sc-ink-soft)] transition-colors hover:text-[var(--sc-ink)]',
    extra,
  ].filter(Boolean).join(' ')
}

export interface PortalTopbarProps {
  variant: 'sidebar' | 'topbar'
  pathname: string
  dashboardHref: string
  changelogHref: string
  profileHref: string
  portalWorkspaceLabel: string
  pageLabel: string
  workspaceOptions: PortalWorkspaceOption[]
  activeOrgId: string
  orgName: string
  workspaceSwitcherLocked: boolean
  onOrgSwitch: (orgId: string) => void
  canOpenAdminView: boolean
  adminViewHref: string
  changelogUnread: number
  initials: string
  uid: string
  displayName: string
  currentPageContext: ContextReferenceSeed | null
  allowAgentParticipants: boolean
  navItems: PortalNavItem[]
  drawerOpen: boolean
  onOpenDrawer: () => void
  onCloseDrawer: () => void
  onToggleDrawer: () => void
  onBack: () => void
  onOpenCommandPalette: () => void
  onToggleLayout: () => void
  onLogout: () => void
}

function ChangelogLink({
  href,
  unread,
}: {
  href: string
  unread: number
}) {
  return (
    <Link
      href={href}
      data-tip={unread > 0 ? `What's new (${unread} unread)` : "What's new"}
      data-tip-side="bottom"
      aria-label={unread > 0 ? `What's new, ${unread} unread` : "What's new"}
      className={['relative', iconBtnClass()].join(' ')}
    >
      <Icon name="campaign" />
      {unread > 0 ? (
        <span
          className="absolute top-2 right-2 h-[6px] w-[6px] bg-[var(--st-info)]"
          style={{ borderRadius: '50%' }}
          aria-hidden="true"
        />
      ) : null}
    </Link>
  )
}

function TopbarChrome({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <header
      className={[
        'st-topbar sticky top-0 z-30 shrink-0 bg-[var(--sc-canvas)] text-[var(--sc-ink)]',
        TOPBAR_H,
        className,
      ].filter(Boolean).join(' ')}
    >
      {children}
    </header>
  )
}

export function PortalTopbar({
  variant,
  pathname,
  dashboardHref,
  changelogHref,
  profileHref,
  portalWorkspaceLabel,
  pageLabel,
  workspaceOptions,
  activeOrgId,
  orgName,
  workspaceSwitcherLocked,
  onOrgSwitch,
  canOpenAdminView,
  adminViewHref,
  changelogUnread,
  initials,
  uid,
  displayName,
  currentPageContext,
  allowAgentParticipants,
  navItems,
  drawerOpen,
  onOpenDrawer,
  onCloseDrawer,
  onToggleDrawer,
  onBack,
  onOpenCommandPalette,
  onToggleLayout,
  onLogout,
}: PortalTopbarProps) {
  if (variant === 'topbar') {
    return (
      <>
        <TopbarChrome>
          <div className="flex items-center h-full px-3 gap-1 sm:px-4">
            <Link href={dashboardHref} className="flex flex-col shrink-0 mr-1 min-w-0">
              <span className="sc-tiny">Partners in Biz</span>
              <span className="sc-tiny text-[var(--sc-ink-soft)] truncate">{portalWorkspaceLabel}</span>
            </Link>

            {workspaceOptions.length > 0 && (
              <div className="hidden md:block shrink-0">
                <ThemedSelect
                  id="portal-topbar-workspace-switcher"
                  ariaLabel="Switch portal workspace"
                  value={activeOrgId}
                  options={workspaceOptions.map(org => ({ value: org.id, label: org.name }))}
                  onValueChange={onOrgSwitch}
                  disabled={workspaceSwitcherLocked}
                  className="min-w-[140px]"
                  buttonClassName="!h-11 !text-xs"
                  menuClassName="bg-[var(--color-pib-surface)] text-[var(--color-pib-text)]"
                />
              </div>
            )}

            <button
              type="button"
              onClick={onBack}
              aria-label="Go back"
              title="Go back"
              className={iconBtnClass('hidden sm:inline-flex')}
            >
              <Icon name="arrow_back" />
            </button>

            <div className="w-px h-4 bg-[var(--sc-line)] shrink-0 hidden md:block" />

            <nav className="hidden md:flex items-center gap-0.5 overflow-x-auto scrollbar-none flex-1 min-w-0">
              {navItems.map(item => {
                const on = isPortalNavActive(pathname, item)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-active={on ? 'true' : undefined}
                    className="pib-nav-item inline-flex items-center gap-2 whitespace-nowrap shrink-0 min-h-11 px-2"
                  >
                    <Icon name={item.icon} className="shrink-0" />
                    <span className="hidden lg:inline">{item.label}</span>
                  </Link>
                )
              })}
            </nav>

            <div className="flex items-center gap-0.5 ml-auto shrink-0">
              {canOpenAdminView && (
                <Link
                  href={adminViewHref}
                  data-tip="Switch to admin view"
                  data-tip-side="bottom"
                  aria-label="Switch to admin view"
                  className={iconBtnClass('hidden md:flex')}
                >
                  <Icon name="person" />
                </Link>
              )}
              <ChangelogLink href={changelogHref} unread={changelogUnread} />
              <button
                type="button"
                onClick={onOpenCommandPalette}
                data-tip="Search (⌘K)"
                data-tip-side="bottom"
                aria-label="Search"
                className={iconBtnClass()}
              >
                <Icon name="search" />
              </button>
              <ThemeToggle />
              <NotificationBell />
              <MessageDrawer
                orgId={activeOrgId}
                orgName={orgName}
                currentUserUid={uid}
                currentUserDisplayName={displayName}
                currentPageContext={currentPageContext}
                allowAgentParticipants={allowAgentParticipants}
              />
              <button
                type="button"
                onClick={onToggleLayout}
                data-tip="Switch to sidebar layout"
                data-tip-side="bottom"
                aria-label="Switch to sidebar layout"
                className={iconBtnClass('hidden md:flex')}
              >
                <Icon name="dock_to_right" />
              </button>
              <SupportDrawer
                orgId={activeOrgId}
                currentPageContext={currentPageContext}
                triggerClassName="hidden sm:inline-flex items-center gap-1 sc-tiny text-[var(--sc-ink-soft)] hover:text-[var(--sc-ink)] transition-colors min-h-11 px-2"
              />
              <Link
                href={profileHref}
                data-tip="My profile"
                data-tip-side="bottom"
                aria-label="My profile"
                className="flex min-h-11 min-w-11 items-center justify-center"
              >
                <Avatar size="sm" initials={initials || '·'} />
              </Link>
              <button
                type="button"
                onClick={onLogout}
                data-tip="Sign out"
                data-tip-side="bottom"
                aria-label="Sign out"
                className={iconBtnClass()}
              >
                <Icon name="logout" />
              </button>
              <button
                type="button"
                onClick={onToggleDrawer}
                aria-label="Open menu"
                className={iconBtnClass('md:hidden flex-col gap-[4px]')}
              >
                <span className="block w-4 h-px bg-[var(--sc-ink-soft)]" />
                <span className="block w-4 h-px bg-[var(--sc-ink-soft)]" />
                <span className="block w-4 h-px bg-[var(--sc-ink-soft)]" />
              </button>
            </div>
          </div>
        </TopbarChrome>

        {drawerOpen && (
          <div className="md:hidden fixed inset-0 z-40 flex flex-col">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={onCloseDrawer}
              aria-hidden="true"
            />
            <div
              className="relative z-10 mt-14 flex max-h-[80vh] flex-col gap-0.5 overflow-y-auto border-b border-[var(--sc-line)] bg-[var(--sc-surface)] p-3"
            >
              {navItems.map(item => {
                const on = isPortalNavActive(pathname, item)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-active={on ? 'true' : undefined}
                    className="pib-nav-item inline-flex items-center gap-2 min-h-11 w-full px-2"
                  >
                    <Icon name={item.icon} className="shrink-0" />
                    <span className="flex-1">{item.label}</span>
                  </Link>
                )
              })}
              <div className="h-px bg-[var(--sc-line)] my-1.5" />
              <button
                type="button"
                onClick={onToggleLayout}
                className="pib-nav-item inline-flex items-center gap-2 min-h-11 w-full px-2 text-left"
              >
                <Icon name="dock_to_right" />
                Switch to sidebar layout
              </button>
              {canOpenAdminView && (
                <Link
                  href={adminViewHref}
                  className="pib-nav-item inline-flex items-center gap-2 min-h-11 w-full px-2"
                  aria-label="Switch to admin view"
                >
                  <Icon name="person" className="shrink-0" />
                  Switch to admin view
                </Link>
              )}
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <TopbarChrome className="flex items-center gap-2 px-3 md:px-5">
      <button
        type="button"
        onClick={onOpenDrawer}
        aria-label="Open menu"
        className={iconBtnClass('md:hidden flex-col gap-[4px] -ml-1.5')}
      >
        <span className="block w-4 h-px bg-[var(--sc-ink-soft)]" />
        <span className="block w-4 h-px bg-[var(--sc-ink-soft)]" />
        <span className="block w-4 h-px bg-[var(--sc-ink-soft)]" />
      </button>
      <button
        type="button"
        onClick={onBack}
        aria-label="Go back"
        data-tip="Go back"
        data-tip-side="bottom"
        className={iconBtnClass()}
      >
        <Icon name="arrow_back" />
      </button>
      <div className="min-w-0 flex-1">
        <Crumbs
          items={[
            { href: dashboardHref, label: 'Client portal' },
            { label: pageLabel },
          ]}
        />
      </div>
      <div className="ml-auto flex items-center gap-0.5 shrink-0">
        {canOpenAdminView && (
          <Link
            href={adminViewHref}
            data-tip="Switch to admin view"
            data-tip-side="bottom"
            aria-label="Switch to admin view"
            className={iconBtnClass('hidden md:flex')}
          >
            <Icon name="person" />
          </Link>
        )}
        <ChangelogLink href={changelogHref} unread={changelogUnread} />
        <button
          type="button"
          onClick={onOpenCommandPalette}
          data-tip="Search (⌘K)"
          data-tip-side="bottom"
          aria-label="Search"
          className={iconBtnClass()}
        >
          <Icon name="search" />
        </button>
        <ThemeToggle />
        <NotificationBell />
        <MessageDrawer
          orgId={activeOrgId}
          orgName={orgName}
          currentUserUid={uid}
          currentUserDisplayName={displayName}
          currentPageContext={currentPageContext}
          allowAgentParticipants={allowAgentParticipants}
        />
        <SupportDrawer
          orgId={activeOrgId}
          currentPageContext={currentPageContext}
          triggerClassName="hidden sm:inline-flex items-center gap-1.5 sc-tiny text-[var(--sc-ink-soft)] hover:text-[var(--sc-ink)] transition-colors min-h-11 px-2"
        />
        <Link
          href={profileHref}
          data-tip="My profile"
          data-tip-side="bottom"
          aria-label="My profile"
          className="flex min-h-11 min-w-11 items-center justify-center"
        >
          <Avatar size="sm" initials={initials || '·'} />
        </Link>
      </div>
    </TopbarChrome>
  )
}
