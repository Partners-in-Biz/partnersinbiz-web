'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Suspense } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, getClientAuth } from '@/lib/firebase/config'
import { logout } from '@/lib/firebase/auth'
import { LastPathTracker } from '@/components/pwa/LastPathTracker'
import { clearLastPath } from '@/lib/pwa/lastPath'
import { WelcomeFlashHandler } from '@/components/ui/WelcomeFlashHandler'
import { SettingsNav } from '@/components/settings/SettingsNav'
import { SupportDrawer } from '@/components/support/SupportDrawer'
import { NotificationBell } from '@/components/crm/NotificationBell'
import { MessageDrawer } from '@/components/chat/MessageDrawer'
import { detectCurrentPageContext } from '@/lib/context-references/route-context'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

const PORTAL_MATERIAL_SYMBOLS =
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap'

interface NavItem {
  href: string
  label: string
  icon: string
  group: 'work' | 'data' | 'comms'
  activePatterns?: string[]
  badge?: number
}

const NAV_LINKS: NavItem[] = [
  { href: '/portal/dashboard', label: 'Overview',  icon: 'space_dashboard', group: 'work' },
  { href: '/portal/briefings', label: 'Briefings', icon: 'team_dashboard', group: 'work' },
  { href: '/portal/projects',  label: 'Projects',  icon: 'rocket_launch',   group: 'work' },
  { href: '/portal/documents', label: 'Documents', icon: 'description',     group: 'work' },
  { href: '/portal/research',  label: 'Research',  icon: 'travel_explore', group: 'data' },
  { href: '/portal/mobile-apps', label: 'Mobile Apps', icon: 'smartphone', group: 'work' },
  {
    href: '/portal/crm',
    label: 'CRM',
    icon: 'contacts',
    group: 'work',
    activePatterns: [
      '/portal/contacts',
      '/portal/companies',
      '/portal/deals',
      '/portal/segments',
      '/portal/capture-sources',
      '/portal/integrations',
      '/portal/reports/crm',
      '/portal/settings/crm-setup',
      '/portal/settings/custom-fields',
      '/portal/settings/pipelines',
      '/portal/settings/scoring',
      '/portal/settings/products',
      '/portal/settings/automations',
      '/portal/settings/sequences',
      '/portal/settings/webhooks',
    ],
  },
  {
    href: '/portal/marketing',
    label: 'Marketing',
    icon: 'campaign',
    group: 'work',
    activePatterns: [
      '/portal/branding',
      '/portal/campaigns',
      '/portal/content-campaigns',
      '/portal/social',
      '/portal/communications',
      '/portal/seo',
      '/portal/capture-sources',
      '/portal/email-domains',
      '/portal/ads',
    ],
  },
  {
    href: '/portal/messages',
    label: 'Messages',
    icon: 'forum',
    group: 'work',
    activePatterns: ['/portal/conversations', '/portal/enquiries'],
  },
  {
    href: '/portal/email',
    label: 'Email',
    icon: 'mail',
    group: 'comms',
    activePatterns: ['/portal/email-domains', '/portal/email-analytics'],
  },
  {
    href: '/portal/reports',
    label: 'Reports',
    icon: 'analytics',
    group: 'data',
    activePatterns: ['/portal/data', '/portal/reports/crm'],
  },
  {
    href: '/portal/properties',
    label: 'Properties',
    icon: 'web_asset',
    group: 'data',
  },
  { href: '/portal/wiki',      label: 'Wiki',      icon: 'menu_book',       group: 'data' },
  { href: '/portal/payments', label: 'Billing', icon: 'payments', group: 'comms' },
]

const GROUP_LABELS: Record<NavItem['group'], string> = {
  work: 'Workspace',
  data: 'Insights',
  comms: 'Account',
}

type LayoutMode = 'sidebar' | 'topbar'

interface PortalOrgOption {
  id: string
  name: string
  slug: string
  type?: string
  logoUrl: string
}

function active(pathname: string, item: NavItem) {
  const hrefPath = item.href.split('?')[0] ?? item.href
  if (pathname === hrefPath || pathname.startsWith(hrefPath + '/')) return true
  return item.activePatterns?.some((pattern) => pathname === pattern || pathname.startsWith(pattern + '/')) ?? false
}

function scopedPortalHref(
  path: string,
  orgId: string,
  orgSlug: string,
  sourceCompanyId = '',
  sourceCompanyName = '',
) {
  if (!orgId) return path
  const params = new URLSearchParams()
  params.set('orgId', orgId)
  if (orgSlug) params.set('orgSlug', orgSlug)
  if (sourceCompanyId) params.set('sourceCompanyId', sourceCompanyId)
  if (sourceCompanyName) params.set('sourceCompanyName', sourceCompanyName)
  return `${path}${path.includes('?') ? '&' : '?'}${params.toString()}`
}

function NavLink({ item, pathname, collapsed }: { item: NavItem; pathname: string; collapsed?: boolean }) {
  const on = active(pathname, item)
  const badge = item.badge && item.badge > 0 ? item.badge : null
  return (
    <Link
      href={item.href}
      title={collapsed && badge ? `${item.label} — ${badge} unread` : collapsed ? item.label : undefined}
      className={[
        'relative flex items-center rounded-lg text-sm transition-all duration-150',
        collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2',
        on
          ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
          : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.03]',
      ].join(' ')}
    >
      <span className={['material-symbols-outlined text-[20px] shrink-0', on ? 'text-[var(--color-pib-accent)]' : 'opacity-70'].join(' ')}>
        {item.icon}
      </span>
      {!collapsed && <span className="font-medium flex-1">{item.label}</span>}
      {badge !== null && !collapsed && (
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[var(--color-pib-accent)] text-black font-semibold leading-none">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {badge !== null && collapsed && (
        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[var(--color-pib-accent)]" />
      )}
    </Link>
  )
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={(
        <>
          <link rel="stylesheet" href={PORTAL_MATERIAL_SYMBOLS} />
          <div className="min-h-screen bg-[var(--color-pib-bg)] flex items-center justify-center">
            <span className="relative flex h-3 w-3">
              <span className="absolute inset-0 rounded-full bg-[var(--color-pib-accent)] opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-[var(--color-pib-accent)]" />
            </span>
          </div>
        </>
      )}
    >
      <PortalLayoutContent>{children}</PortalLayoutContent>
    </Suspense>
  )
}

function PortalLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const requestedOrgId = searchParams.get('orgId')?.trim() ?? ''
  const requestedOrgSlug = searchParams.get('orgSlug')?.trim() ?? ''
  const requestedSourceCompanyId = searchParams.get('sourceCompanyId')?.trim() ?? ''
  const requestedSourceCompanyName = searchParams.get('sourceCompanyName')?.trim() ?? ''
  const isEmailRoute = pathname === '/portal/email' || pathname.startsWith('/portal/email/')
  const isMessagesRoute = pathname === '/portal/messages' || pathname.startsWith('/portal/messages/')
  const isWorkspaceRoute = isEmailRoute || isMessagesRoute

  const [email, setEmail]       = useState('')
  const [name, setName]         = useState('')
  const [uid, setUid]           = useState('')
  const [orgName, setOrgName]   = useState('')
  const [checking, setChecking] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed]   = useState(false)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('sidebar')
  const [documentCount, setDocumentCount] = useState(0)
  const [orgs, setOrgs] = useState<PortalOrgOption[]>([])
  const [activeOrgId, setActiveOrgId] = useState('')
  const [activeOrgSlug, setActiveOrgSlug] = useState('')
  const [activeOrgType, setActiveOrgType] = useState('')
  const [userRole, setUserRole] = useState('')
  const [orgSwitching, setOrgSwitching] = useState(false)
  const [memberRole, setMemberRole] = useState<string | null>(null)
  const [profileName, setProfileName] = useState('')

  // Restore persisted preferences
  useEffect(() => {
    const c = localStorage.getItem('portal_sidebar_collapsed')
    if (c === 'true') setCollapsed(true)
    const m = localStorage.getItem('portal_layout_mode') as LayoutMode | null
    if (m === 'sidebar' || m === 'topbar') setLayoutMode(m)
  }, [])

  // Mail and messages need workspace more than navigation; collapse the sidebar
  // automatically when users enter those full-height work areas.
  useEffect(() => {
    if (!isWorkspaceRoute) return
    setCollapsed((prev) => {
      if (prev) return prev
      localStorage.setItem('portal_sidebar_collapsed', 'true')
      return true
    })
  }, [isWorkspaceRoute])

  // Auth check
  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | null = null

    getClientAuth().authStateReady().then(() => {
      if (cancelled) return
      unsubscribe = onAuthStateChanged(auth, (user) => {
        if (!user) {
          router.push('/login')
        } else {
          setEmail(user.email ?? '')
          setUid(user.uid)
          setName(user.displayName ?? user.email?.split('@')[0] ?? '')
          setChecking(false)
          const portalOrgUrl = requestedOrgId
            ? `/api/v1/portal/org?orgId=${encodeURIComponent(requestedOrgId)}`
            : '/api/v1/portal/org'
          fetch(portalOrgUrl)
            .then(r => r.ok ? r.json() : null)
            .then(d => {
              if (d?.org?.name) setOrgName(d.org.name)
              if (d?.org?.id) setActiveOrgId(d.org.id)
              if (d?.org?.slug) setActiveOrgSlug(d.org.slug)
              if (d?.org?.type) setActiveOrgType(d.org.type)
              if (d?.user?.role) setUserRole(d.user.role)
            })
            .catch(() => {})
          fetch('/api/v1/portal/orgs')
            .then(r => r.ok ? r.json() : null)
            .then(d => {
              if (Array.isArray(d?.orgs)) setOrgs(d.orgs)
              const nextActiveOrgId = requestedOrgId || d?.activeOrgId
              if (nextActiveOrgId) setActiveOrgId(nextActiveOrgId)
              const activeOrg = Array.isArray(d?.orgs)
                ? d.orgs.find((org: PortalOrgOption) => org.id === nextActiveOrgId)
                : null
              if (activeOrg?.name) setOrgName(activeOrg.name)
              if (activeOrg?.slug) setActiveOrgSlug(activeOrg.slug)
              if (activeOrg?.type) setActiveOrgType(activeOrg.type)
              if (requestedOrgId && d?.activeOrgId !== requestedOrgId) {
                fetch('/api/v1/portal/active-org', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ orgId: requestedOrgId }),
                }).catch(() => {})
              }
            })
            .catch(() => {})
          fetch('/api/v1/portal/settings/profile')
            .then(r => r.ok ? r.json() : null)
            .then(d => {
              if (d?.profile?.firstName) {
                setProfileName(`${d.profile.firstName} ${d.profile.lastName ?? ''}`.trim())
              }
              if (d?.profile?.role) setMemberRole(d.profile.role)
            })
            .catch(() => {})
        }
      })
    })

    return () => { cancelled = true; unsubscribe?.() }
  }, [router, requestedOrgId])

  // Close mobile drawer on navigation
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  // Document badge — refresh on mount, on route change, and every 60s.
  useEffect(() => {
    if (checking) return
    let cancelled = false
    async function refresh() {
      try {
        const res = await fetch(requestedOrgId
          ? `/api/v1/portal/documents/count?orgId=${encodeURIComponent(requestedOrgId)}`
          : '/api/v1/portal/documents/count')
        if (!res.ok) return
        const body = await res.json()
        const count = body?.data?.count ?? 0
        if (!cancelled) setDocumentCount(typeof count === 'number' ? count : 0)
      } catch {}
    }
    refresh()
    const id = window.setInterval(refresh, 60_000)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [checking, pathname, requestedOrgId])

  function toggleCollapsed() {
    setCollapsed(prev => {
      localStorage.setItem('portal_sidebar_collapsed', String(!prev))
      return !prev
    })
  }

  function toggleLayout() {
    setLayoutMode(prev => {
      const next: LayoutMode = prev === 'sidebar' ? 'topbar' : 'sidebar'
      localStorage.setItem('portal_layout_mode', next)
      return next
    })
  }

  async function handleOrgSwitch(orgId: string) {
    if (orgId === activeOrgId || orgSwitching) return
    setOrgSwitching(true)
    const switched = orgs.find(o => o.id === orgId)
    try {
      await fetch('/api/v1/portal/active-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      setActiveOrgId(orgId)
      if (switched) {
        setOrgName(switched.name)
        setActiveOrgSlug(switched.slug)
        setActiveOrgType(switched.type ?? '')
      }
      if (requestedOrgId) {
        router.push(scopedPortalHref(pathname, orgId, switched?.slug ?? ''))
      } else {
        router.refresh()
      }
    } finally {
      setOrgSwitching(false)
    }
  }

  async function handleLogout() {
    clearLastPath()
    await logout()
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    router.push('/')
  }

  if (checking) {
    return (
      <>
        <link rel="stylesheet" href={PORTAL_MATERIAL_SYMBOLS} />
        <div className="min-h-screen bg-[var(--color-pib-bg)] flex items-center justify-center">
          <span className="relative flex h-3 w-3">
            <span className="absolute inset-0 rounded-full bg-[var(--color-pib-accent)] opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-[var(--color-pib-accent)]" />
          </span>
        </div>
      </>
    )
  }

  const scopedShellHref = (path: string) =>
    requestedOrgId
      ? scopedPortalHref(
          path,
          requestedOrgId,
          requestedOrgSlug || activeOrgSlug,
          requestedSourceCompanyId,
          requestedSourceCompanyName,
        )
      : path

  const navWithBadges: NavItem[] = NAV_LINKS.map((item) => {
    const href = requestedOrgId
      ? scopedShellHref(item.href)
      : item.href
    return item.href === '/portal/documents' ? { ...item, href, badge: documentCount } : { ...item, href }
  })

  const grouped = (['work', 'data', 'comms'] as const).map(g => ({
    group: g,
    items: navWithBadges.filter(n => n.group === g),
  }))
  const requestedWorkspaceOption: PortalOrgOption | null = activeOrgId && orgName && !orgs.some(org => org.id === activeOrgId)
    ? {
        id: activeOrgId,
        name: orgName,
        slug: activeOrgSlug || requestedOrgSlug,
        type: activeOrgType,
        logoUrl: '',
      }
    : null
  const workspaceOptions = requestedWorkspaceOption ? [requestedWorkspaceOption, ...orgs] : orgs

  const initials = (name || email).split(/[.\s@]/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('')
  const canOpenAdminView = userRole === 'admin' && !!activeOrgSlug
  const adminViewHref = activeOrgSlug ? `/admin/org/${activeOrgSlug}/dashboard` : '/admin/dashboard'
  const allowAgentParticipants = userRole === 'admin'
  const portalWorkspaceLabel = activeOrgType === 'platform_owner' || activeOrgId === PIB_PLATFORM_ORG_ID ? 'Platform' : 'Client'
  const currentPageContext = detectCurrentPageContext({
    pathname,
    searchParams,
    orgId: activeOrgId,
  })

  const tracker = (
    <>
      <Suspense fallback={null}>
        <LastPathTracker />
      </Suspense>
      <WelcomeFlashHandler />
    </>
  )

  // ── Topbar mode ────────────────────────────────────────────────────────────
  if (layoutMode === 'topbar') {
    return (
      <>
        <link rel="stylesheet" href={PORTAL_MATERIAL_SYMBOLS} />
        <div data-message-push-root className="flex flex-col min-h-screen bg-[var(--color-pib-bg)] text-[var(--color-pib-text)]">
          {tracker}
          <header className="h-14 sticky top-0 z-30 bg-[var(--color-pib-bg)]/95 backdrop-blur-md border-b border-[var(--color-pib-line)] shrink-0">
          <div className="flex items-center h-full px-4 gap-2">
            {/* Brand */}
            <Link href={scopedShellHref('/portal/dashboard')} className="flex items-center gap-2 shrink-0 mr-2">
              <Image src="/pib-logo-512.png" alt="Partners in Biz" width={24} height={24} className="rounded-md object-contain" />
              <span className="hidden sm:block font-display text-base leading-none">Partners in Biz</span>
              <span className="pill !text-[10px] !py-0.5 !px-2">{portalWorkspaceLabel}</span>
            </Link>

            <div className="w-px h-5 bg-[var(--color-pib-line)] shrink-0 hidden md:block" />

            {/* Nav — scrollable */}
            <nav className="hidden md:flex items-center gap-0.5 overflow-x-auto scrollbar-none flex-1 min-w-0">
              {navWithBadges.map(item => {
                const on = active(pathname, item)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={[
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-all duration-150',
                      on
                        ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
                        : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.04]',
                    ].join(' ')}
                  >
                    <span className={['material-symbols-outlined text-[18px] shrink-0', on ? 'text-[var(--color-pib-accent)]' : 'opacity-70'].join(' ')}>
                      {item.icon}
                    </span>
                    <span className="hidden lg:inline font-medium">{item.label}</span>
                    {item.badge && item.badge > 0 && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[var(--color-pib-accent)] text-black font-semibold leading-none">
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    )}
                  </Link>
                )
              })}
            </nav>

            {/* Right side */}
            <div className="flex items-center gap-2 ml-auto shrink-0">
              {canOpenAdminView && (
                <Link
                  href={adminViewHref}
                  title="Switch to admin view"
                  aria-label="Switch to admin view"
                  className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05] transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">person</span>
                </Link>
              )}
              <NotificationBell />
              <MessageDrawer
                orgId={activeOrgId}
                orgName={orgName}
                currentUserUid={uid}
                currentUserDisplayName={profileName || name || email}
                currentPageContext={currentPageContext}
                allowAgentParticipants={allowAgentParticipants}
              />
              <button
                onClick={toggleLayout}
                title="Switch to sidebar layout"
                className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05] transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">dock_to_right</span>
              </button>
              <SupportDrawer
                orgId={activeOrgId}
                currentPageContext={currentPageContext}
                triggerClassName="hidden sm:inline-flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
              />
              <div className="w-8 h-8 rounded-full bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-line-strong)] flex items-center justify-center text-xs font-medium text-[var(--color-pib-accent-hover)]">
                <Link href={scopedShellHref('/portal/settings/profile')} title="My profile" className="grid h-full w-full place-items-center rounded-full">
                  {initials || '·'}
                </Link>
              </div>
              <button
                onClick={handleLogout}
                title="Sign out"
                className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors p-1"
              >
                <span className="material-symbols-outlined text-[18px]">logout</span>
              </button>
              {/* Mobile hamburger */}
              <button
                type="button"
                onClick={() => setDrawerOpen(v => !v)}
                aria-label="Open menu"
                className="md:hidden flex flex-col justify-center items-center w-9 h-9 gap-[4px] rounded-lg hover:bg-white/[0.06] transition-colors"
              >
                <span className="block w-4 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
                <span className="block w-4 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
                <span className="block w-4 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
              </button>
            </div>
          </div>
        </header>

        {/* Mobile drawer in topbar mode */}
        {drawerOpen && (
          <div className="md:hidden fixed inset-0 z-40 flex flex-col">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
            <div className="relative z-10 mt-14 bg-[var(--color-pib-bg)] border-b border-[var(--color-pib-line)] p-4 flex flex-col gap-1 max-h-[80vh] overflow-y-auto">
              {navWithBadges.map(item => {
                const on = active(pathname, item)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={[
                      'flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors',
                      on
                        ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
                        : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.04]',
                    ].join(' ')}
                  >
                    <span className="material-symbols-outlined text-[18px] opacity-70">{item.icon}</span>
                    <span className="flex-1">{item.label}</span>
                    {item.badge && item.badge > 0 && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[var(--color-pib-accent)] text-black font-semibold leading-none">
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    )}
                  </Link>
                )
              })}
              <div className="h-px bg-[var(--color-pib-line)] my-2" />
              <button
                onClick={toggleLayout}
                className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] rounded-lg hover:bg-white/[0.04]"
              >
                <span className="material-symbols-outlined text-[18px]">dock_to_right</span>
                Switch to sidebar layout
              </button>
              {canOpenAdminView && (
                <Link
                  href={adminViewHref}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] rounded-lg hover:bg-white/[0.04]"
                >
                  <span className="material-symbols-outlined text-[18px] inline-flex items-center justify-center min-w-[18px] min-h-[18px] leading-none">person</span>
                  Switch to admin view
                </Link>
              )}
            </div>
          </div>
        )}

        <main className={isWorkspaceRoute
          ? 'flex-1 min-h-0 overflow-hidden px-3 md:px-5 py-4 w-full max-w-none'
          : 'flex-1 overflow-y-auto px-4 md:px-8 py-8 max-w-[1400px] mx-auto w-full'
        }>{children}</main>

        {!isWorkspaceRoute && (
          <footer className="px-4 md:px-8 py-6 border-t border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] text-xs flex flex-wrap items-center justify-between gap-3">
            <span>© {new Date().getFullYear()} Partners in Biz · Pretoria</span>
            <div className="flex items-center gap-4">
              <Link href="/privacy-policy" className="hover:text-[var(--color-pib-text)] transition-colors">Privacy</Link>
              <Link href="/terms-of-service" className="hover:text-[var(--color-pib-text)] transition-colors">Terms</Link>
            </div>
          </footer>
        )}
        </div>
      </>
    )
  }

  // ── Sidebar mode ───────────────────────────────────────────────────────────
  return (
    <>
      <link rel="stylesheet" href={PORTAL_MATERIAL_SYMBOLS} />
      <div data-message-push-root className="min-h-screen bg-[var(--color-pib-bg)] text-[var(--color-pib-text)] flex">
        {tracker}
      {/* Mobile backdrop */}
      <div
        onClick={() => setDrawerOpen(false)}
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
          collapsed ? 'w-16' : 'w-[260px]',
          drawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        ].join(' ')}
      >
        {/* Brand */}
        <Link
          href={scopedShellHref('/portal/dashboard')}
          className={['flex items-center min-h-16 border-b border-[var(--color-pib-line)] shrink-0', collapsed ? 'justify-center px-0' : 'gap-2.5 px-5 py-3'].join(' ')}
        >
          <Image src="/pib-logo-512.png" alt="Partners in Biz" width={28} height={28} className="rounded-md object-contain shrink-0" />
          {!collapsed && (
            <>
              <div className="flex flex-col min-w-0">
                <span className="font-display text-base leading-tight">Partners in Biz</span>
                {orgName && <span className="text-[11px] text-[var(--color-pib-text-muted)] truncate leading-tight mt-0.5">{orgName}</span>}
              </div>
              <span className="ml-auto pill !text-[10px] !py-0.5 !px-2 shrink-0">{portalWorkspaceLabel}</span>
            </>
          )}
        </Link>

        {/* Collapse and mode switch controls */}
        <div className="hidden md:flex items-center justify-between h-8 border-b border-[var(--color-pib-line)] shrink-0">
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={[
              'flex h-8 items-center justify-center text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors',
              collapsed ? 'w-full' : 'w-8 border-r border-[var(--color-pib-line)]',
            ].join(' ')}
          >
            <span className="material-symbols-outlined text-[18px]">
              {collapsed ? 'chevron_right' : 'chevron_left'}
            </span>
          </button>
          {!collapsed && canOpenAdminView && (
            <Link
              href={adminViewHref}
              title="Switch to admin view"
              aria-label="Switch to admin view"
              className="h-8 w-8 border-l border-[var(--color-pib-line)] flex items-center justify-center text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05] transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">person</span>
            </Link>
          )}
        </div>

        {!collapsed && canOpenAdminView && (
          <div className="md:hidden border-b border-[var(--color-pib-line)] shrink-0 px-3 py-3">
            <Link
              href={adminViewHref}
              title="Switch to admin view"
              aria-label="Switch to admin view"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.03] hover:text-[var(--color-pib-text)]"
            >
              <span className="material-symbols-outlined text-[20px] shrink-0 opacity-70">person</span>
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
              className="mx-auto my-2 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05] transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">person</span>
            </Link>
          </div>
        )}

        {/* Workspace switcher — compact, near the top like the admin context. */}
        {workspaceOptions.length > 1 && (
          <div className="border-b border-[var(--color-pib-line)] shrink-0">
            {collapsed ? (
              <button
                type="button"
                onClick={toggleCollapsed}
                title={`Workspace: ${orgName || 'Current workspace'}`}
                className="mx-auto my-2 w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold transition-colors bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)] ring-1 ring-[var(--color-pib-accent)]/30"
              >
                {(orgName || workspaceOptions.find(org => org.id === activeOrgId)?.name || 'W')[0]?.toUpperCase() ?? 'W'}
              </button>
            ) : (
              <div className="px-3 py-3">
                <label htmlFor="portal-workspace-switcher" className="eyebrow !text-[10px] px-1 mb-2 block">
                  Workspace
                </label>
                <div className="relative">
                  <select
                    id="portal-workspace-switcher"
                    value={activeOrgId}
                    onChange={(event) => handleOrgSwitch(event.target.value)}
                    disabled={orgSwitching}
                    className="w-full appearance-none rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] px-3 py-2 pr-9 text-sm text-[var(--color-pib-text)] outline-none transition-colors hover:bg-white/[0.04] focus:border-[var(--color-pib-accent)] disabled:opacity-60"
                  >
                    {workspaceOptions.map(org => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-[18px] text-[var(--color-pib-text-muted)]">
                    expand_more
                  </span>
                </div>
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
            collapsed={collapsed}
          />
        ) : (
          <nav className={['flex-1 overflow-y-auto py-4', collapsed ? 'px-2 space-y-1' : 'px-3 space-y-5'].join(' ')}>
            {collapsed
              ? navWithBadges.map(item => <NavLink key={item.href} item={item} pathname={pathname} collapsed />)
              : grouped.map(({ group, items }) => (
                  <div key={group} className="space-y-1">
                    <p className="eyebrow !text-[10px] px-3 mb-2">{GROUP_LABELS[group]}</p>
                    {items.map(item => <NavLink key={item.href} item={item} pathname={pathname} />)}
                  </div>
                ))
            }
          </nav>
        )}

        {/* User chip */}
        <div className="border-t border-[var(--color-pib-line)] p-3 shrink-0">
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <Link
                href={scopedShellHref('/portal/settings/profile')}
                title="My profile"
                className="w-8 h-8 rounded-full bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-line-strong)] flex items-center justify-center text-xs font-medium text-[var(--color-pib-accent-hover)] hover:ring-2 hover:ring-[var(--color-pib-accent)]/40 transition-all"
              >
                {initials || '·'}
              </Link>
              <button onClick={handleLogout} title="Sign out" className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors p-1">
                <span className="material-symbols-outlined text-[18px]">logout</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
              <Link
                href={scopedShellHref('/portal/settings/profile')}
                title="My profile"
                className="w-8 h-8 rounded-full bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-line-strong)] flex items-center justify-center text-xs font-medium text-[var(--color-pib-accent-hover)] hover:ring-2 hover:ring-[var(--color-pib-accent)]/40 transition-all shrink-0"
              >
                {initials || '·'}
              </Link>
              <Link href={scopedShellHref('/portal/settings/profile')} className="flex-1 min-w-0 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--color-pib-accent)]/40">
                <p className="text-xs font-medium truncate">{profileName || name || 'Client'}</p>
                <p className="text-[11px] text-[var(--color-pib-text-muted)] truncate">{email}</p>
              </Link>
              <button onClick={handleLogout} title="Sign out" className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors p-1" aria-label="Sign out">
                <span className="material-symbols-outlined text-[18px]">logout</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Topbar */}
        <header className="h-14 sticky top-0 z-30 bg-[var(--color-pib-bg)]/80 backdrop-blur-md border-b border-[var(--color-pib-line)] flex items-center px-4 md:px-8 gap-3">
          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="md:hidden flex flex-col justify-center items-center w-9 h-9 gap-[4px] rounded-lg hover:bg-white/[0.06] transition-colors -ml-1.5"
          >
            <span className="block w-4 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
            <span className="block w-4 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
            <span className="block w-4 h-[1.5px] bg-[var(--color-pib-text-muted)]" />
          </button>
          <span className="eyebrow !text-[10px]">Client portal</span>
          <span className="hidden sm:inline w-1 h-1 rounded-full bg-[var(--color-pib-line-strong)]" />
          <span className="hidden sm:inline text-xs text-[var(--color-pib-text-muted)]">
            {NAV_LINKS.find(n => active(pathname, n))?.label ?? 'Overview'}
          </span>
          <div className="ml-auto flex items-center gap-3">
            {canOpenAdminView && (
              <Link
                href={adminViewHref}
                title="Switch to admin view"
                className="hidden md:flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05] transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">person</span>
                <span className="hidden lg:inline">Admin</span>
              </Link>
            )}
            <NotificationBell />
            <MessageDrawer
              orgId={activeOrgId}
              orgName={orgName}
              currentUserUid={uid}
              currentUserDisplayName={profileName || name || email}
              currentPageContext={currentPageContext}
              allowAgentParticipants={allowAgentParticipants}
            />
            <SupportDrawer
              orgId={activeOrgId}
              currentPageContext={currentPageContext}
              triggerClassName="hidden sm:inline-flex items-center gap-1.5 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
            />
          </div>
        </header>

        <main className={isWorkspaceRoute
          ? 'flex-1 min-h-0 overflow-hidden px-3 md:px-5 py-4 w-full max-w-none'
          : 'flex-1 overflow-y-auto px-4 md:px-8 py-8 max-w-[1400px] mx-auto w-full'
        }>{children}</main>

        {!isWorkspaceRoute && (
          <footer className="px-4 md:px-8 py-6 border-t border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] text-xs flex flex-wrap items-center justify-between gap-3">
            <span>© {new Date().getFullYear()} Partners in Biz · Pretoria</span>
            <div className="flex items-center gap-4">
              <Link href="/privacy-policy" className="hover:text-[var(--color-pib-text)] transition-colors">Privacy</Link>
              <Link href="/terms-of-service" className="hover:text-[var(--color-pib-text)] transition-colors">Terms</Link>
            </div>
          </footer>
        )}
      </div>
      </div>
    </>
  )
}
