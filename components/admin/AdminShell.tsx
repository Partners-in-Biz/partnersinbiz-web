'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { AdminSidebar } from './AdminSidebar'
import { AdminTopbar } from './AdminTopbar'
import { AdminTopbarNav } from './AdminTopbarNav'
import { WelcomeFlashHandler } from '@/components/ui/WelcomeFlashHandler'
import { MessageDrawer } from '@/components/chat/MessageDrawer'
import { useOrg } from '@/lib/contexts/OrgContext'
import { PIB_PLATFORM_ORG_ID, SHARED_SENDER_NAME } from '@/lib/platform/constants'

interface AdminShellProps {
  userEmail: string
  userUid: string
  children: React.ReactNode
}

type LayoutMode = 'sidebar' | 'topbar'

export function AdminShell({ userEmail, userUid, children }: AdminShellProps) {
  const pathname = usePathname()
  const { selectedOrgId, orgName, orgs } = useOrg()
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('sidebar_collapsed') === 'true'
  })
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    if (typeof window === 'undefined') return 'sidebar'
    const storedLayout = localStorage.getItem('admin_layout') as LayoutMode | null
    return storedLayout === 'topbar' || storedLayout === 'sidebar' ? storedLayout : 'sidebar'
  })

  function toggleCollapsed() {
    setCollapsed((prev) => {
      localStorage.setItem('sidebar_collapsed', String(!prev))
      return !prev
    })
  }

  function toggleLayout() {
    setLayoutMode((prev) => {
      const next: LayoutMode = prev === 'sidebar' ? 'topbar' : 'sidebar'
      localStorage.setItem('admin_layout', next)
      return next
    })
  }

  function openSidebar() {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      setCollapsed(false)
      localStorage.setItem('sidebar_collapsed', 'false')
    }
    setOpen(true)
  }

  function closeSidebarForMessages() {
    setOpen(false)
    setCollapsed(true)
    localStorage.setItem('sidebar_collapsed', 'true')
  }

  const routeOrgSlug = pathname.match(/^\/admin\/org\/([^/]+)/)?.[1]
  const routeOrg = routeOrgSlug ? orgs.find((org) => org.slug === routeOrgSlug) : undefined
  const selectedOrg = orgs.find((org) => org.id === selectedOrgId)
  const drawerOrg = routeOrg ?? selectedOrg
  const drawerOrgId = (drawerOrg?.id ?? selectedOrgId) || PIB_PLATFORM_ORG_ID
  const drawerOrgName = (drawerOrg?.name ?? orgName) || SHARED_SENDER_NAME
  const isMessagesPage = /^\/admin\/org\/[^/]+\/messages(?:\/|$)/.test(pathname)
  const mainClassName = isMessagesPage
    ? 'flex-1 overflow-y-auto px-2 md:px-4 py-4'
    : 'flex-1 overflow-y-auto px-4 md:px-8 py-8'
  const innerClassName = isMessagesPage ? 'w-full' : 'max-w-[1400px] mx-auto w-full'
  const messageAction = (
    <MessageDrawer
      orgId={drawerOrgId}
      orgName={drawerOrgName}
      currentUserUid={userUid}
      currentUserDisplayName={userEmail}
      allowAgentParticipants
      allowDeleteConversations
      disabledReason="Messages unavailable"
      onOpen={closeSidebarForMessages}
    />
  )

  if (layoutMode === 'topbar') {
    return (
      <div data-message-push-root className="flex flex-col h-screen overflow-hidden bg-[var(--color-pib-bg)] text-[var(--color-pib-text)]">
        <WelcomeFlashHandler />
        <AdminTopbarNav userEmail={userEmail} onToggleLayout={toggleLayout} messageAction={messageAction} />
        <main className={mainClassName}>
          <div className={innerClassName}>
            {children}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div data-message-push-root className="flex h-screen overflow-hidden bg-[var(--color-pib-bg)] text-[var(--color-pib-text)]">
      <WelcomeFlashHandler />
      <AdminSidebar open={open} onClose={() => setOpen(false)} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <AdminTopbar
          userEmail={userEmail}
          onMenuClick={openSidebar}
          onToggleLayout={toggleLayout}
          messageAction={messageAction}
        />
        <main className={mainClassName}>
          <div className={innerClassName}>
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
