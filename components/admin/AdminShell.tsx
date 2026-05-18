'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { AdminSidebar } from './AdminSidebar'
import { AdminTopbar } from './AdminTopbar'
import { AdminTopbarNav } from './AdminTopbarNav'
import { WelcomeFlashHandler } from '@/components/ui/WelcomeFlashHandler'
import { MessageDrawer } from '@/components/chat/MessageDrawer'
import { useOrg } from '@/lib/contexts/OrgContext'

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

  const routeOrgSlug = pathname.match(/^\/admin\/org\/([^/]+)/)?.[1]
  const routeOrg = routeOrgSlug ? orgs.find((org) => org.slug === routeOrgSlug) : undefined
  const selectedOrg = orgs.find((org) => org.id === selectedOrgId)
  const drawerOrg = routeOrg ?? selectedOrg
  const drawerOrgId = drawerOrg?.id ?? selectedOrgId
  const drawerOrgName = drawerOrg?.name ?? orgName
  const messageAction = (
    <MessageDrawer
      orgId={drawerOrgId}
      orgName={drawerOrgName}
      currentUserUid={userUid}
      currentUserDisplayName={userEmail}
      allowAgentParticipants
      allowDeleteConversations
      disabledReason="Select a client workspace first"
    />
  )

  if (layoutMode === 'topbar') {
    return (
      <div data-message-push-root className="flex flex-col h-screen overflow-hidden bg-[var(--color-pib-bg)] text-[var(--color-pib-text)]">
        <WelcomeFlashHandler />
        <AdminTopbarNav userEmail={userEmail} onToggleLayout={toggleLayout} messageAction={messageAction} />
        <main className="flex-1 overflow-y-auto px-4 md:px-8 py-8">
          <div className="max-w-[1400px] mx-auto w-full">
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
          onMenuClick={() => setOpen(true)}
          onToggleLayout={toggleLayout}
          messageAction={messageAction}
        />
        <main className="flex-1 overflow-y-auto px-4 md:px-8 py-8">
          <div className="max-w-[1400px] mx-auto w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
