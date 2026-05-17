'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
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
  { href: '/portal/projects',  label: 'Projects',  icon: 'rocket_launch',   group: 'work' },
  { href: '/portal/documents', label: 'Documents', icon: 'description',     group: 'work' },
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
      '/portal/seo',
      '/portal/capture-sources',
      '/portal/contacts',
      '/portal/segments',
      '/portal/email-domains',
      '/portal/integrations',
      '/portal/ads',
    ],
  },
  {
    href: '/portal/companies',
    label: 'Companies',
    icon: 'domain',
    group: 'work',
    activePatterns: ['/portal/companies'],
  },
  {
    href: '/portal/deals',
    label: 'Deals',
    icon: 'monetization_on',
    group: 'work',
    activePatterns: ['/portal/deals'],
  },
  {
    href: '/portal/messages',
    label: 'Messages',
    icon: 'forum',
    group: 'work',
    activePatterns: ['/portal/conversations', '/portal/enquiries'],
  },
  {
    href: '/portal/reports',
    label: 'Reports',
    icon: 'analytics',
    group: 'data',
    activePatterns: ['/portal/email-analytics', '/portal/properties', '/portal/data'],
  },
  { href: '/portal/payments', label: 'Billing', icon: 'payments', group: 'comms' },
]

const GROUP_LABELS: Record<NavItem['group'], string> = {
  work: 'Workspace',
  data: 'Insights',
  comms: 'Account',
}

type LayoutMode = 'sidebar' | 'topbar'

function active(pathname: string, item: NavItem) {
  if (pathname === item.href || pathname.startsWith(item.href + '/')) return true
  return item.activePatterns?.some((pattern) => pathname === pattern || pathname.startsWith(pattern + '/')) ?? false
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
  const router = useRouter()
  const pathname = usePathname()

  const [email, setEmail]       = useState('')
  const [name, setName]         = useState('')
  const [orgName, setOrgName]   = useState('')
  const [checking, setChecking] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed]   = useState(false)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('sidebar')
  const [unresolvedDocs, setUnresolvedDocs] = useState(0)
  const [orgs, setOrgs] = useState<{ id: string; name: string; logoUrl: string }[]>([])
  const [activeOrgId, setActiveOrgId] = useState('')
  const [orgSwitching, setOrgSwitching] = useState(false)
  const [memberRole, setMemberRole] = useState<string | null>(null)
  const [profileName, setProfileName] = useState('')

  // Restore persisted preferences
  useEffect(() => {
    const c = localStorage.getItem('portal_sidebar_collapsed')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (c === 'true') setCollapsed(true)
    const m = localStorage.getItem('portal_layout_mode') as LayoutMode | null
    if (m === 'sidebar' || m === 'topbar') setLayoutMode(m)
  }, [])

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
          setName(user.displayName ?? user.email?.split('@')[0] ?? '')
          setChecking(false)
          fetch('/api/v1/portal/org')
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?.org?.name) setOrgName(d.org.name) })
            .catch(() => {})
          fetch('/api/v1/portal/orgs')
            .then(r => r.ok ? r.json() : null)
            .then(d => {
              if (Array.isArray(d?.orgs)) setOrgs(d.orgs)
              if (d?.activeOrgId) setActiveOrgId(d.activeOrgId)
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
  }, [router])

  // Close mobile drawer on navigation
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrawerOpen(false)
  }, [pathname])

  // Unresolved comments badge — refresh on mount, on route change, and every 60s
  useEffect(() => {
    if (checking) return
    let cancelled = false
    async function refresh() {
      try {
        const res = await fetch('/api/v1/portal/documents/unresolved-count')
        if (!res.ok) return
        const body = await res.json()
        const count = body?.data?.count ?? 0
        if (!cancelled) setUnresolvedDocs(typeof count === 'number' ? count : 0)
      } catch {}
    }
    refresh()
    const id = window.setInterval(refresh, 60_000)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [checking, pathname])

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
    try {
      await fetch('/api/v1/portal/active-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      setActiveOrgId(orgId)
      const switched = orgs.find(o => o.id === orgId)
      if (switched) setOrgName(switched.name)
      router.refresh()
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
      <div className="min-h-screen bg-[var(--color-pib-bg)] flex items-center justify-center">
        <span className="relative flex h-3 w-3">
          <span className="absolute inset-0 rounded-full bg-[var(--color-pib-accent)] opacity-75 animate-ping" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-[var(--color-pib-accent)]" />
        </span>
      </div>
    )
  }

  const navWithBadges: NavItem[] = NAV_LINKS.map((item) =>
    item.href === '/portal/documents' ? { ...item, badge: unresolvedDocs } : item,
  )

  const grouped = (['work', 'data', 'comms'] as const).map(g => ({
    group: g,
    items: navWithBadges.filter(n => n.group === g),
  }))

  const initials = (name || email).split(/[.\s@]/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('')

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
      <div className="flex flex-col min-h-screen bg-[var(--color-pib-bg)] text-[var(--color-pib-text)]">
        {tracker}
        <header className="h-14 sticky top-0 z-30 bg-[var(--color-pib-bg)]/95 backdrop-blur-md border-b border-[var(--color-pib-line)] shrink-0">
          <div className="flex items-center h-full px-4 gap-2">
            {/* Brand */}
            <Link href="/portal/dashboard" className="flex items-center gap-2 shrink-0 mr-2">
              <Image src="/pib-logo-512.png" alt="Partners in Biz" width={24} height={24} className="rounded-md object-contain" />
              <span className="hidden sm:block font-display text-base leading-none">Partners in Biz</span>
              <span className="pill !text-[10px] !py-0.5 !px-2">Client</span>
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
              <button
                onClick={toggleLayout}
                title="Switch to sidebar layout"
                className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05] transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">dock_to_right</span>
              </button>
              <SupportDrawer triggerClassName="hidden sm:inline-flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors" />
              <div className="w-8 h-8 rounded-full bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-line-strong)] flex items-center justify-center text-xs font-medium text-[var(--color-pib-accent-hover)]">
                {initials || '·'}
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
            </div>
          </div>
        )}

        <main className="flex-1 px-4 md:px-8 py-8 max-w-6xl mx-auto w-full">{children}</main>

        <footer className="px-4 md:px-8 py-6 border-t border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] text-xs flex flex-wrap items-center justify-between gap-3">
          <span>© {new Date().getFullYear()} Partners in Biz · Pretoria</span>
          <div className="flex items-center gap-4">
            <Link href="/privacy-policy" className="hover:text-[var(--color-pib-text)] transition-colors">Privacy</Link>
            <Link href="/terms-of-service" className="hover:text-[var(--color-pib-text)] transition-colors">Terms</Link>
          </div>
        </footer>
      </div>
    )
  }

  // ── Sidebar mode ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--color-pib-bg)] text-[var(--color-pib-text)] flex">
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
          href="/portal/dashboard"
          className={['flex items-center min-h-16 border-b border-[var(--color-pib-line)] shrink-0', collapsed ? 'justify-center px-0' : 'gap-2.5 px-5 py-3'].join(' ')}
        >
          <Image src="/pib-logo-512.png" alt="Partners in Biz" width={28} height={28} className="rounded-md object-contain shrink-0" />
          {!collapsed && (
            <>
              <div className="flex flex-col min-w-0">
                <span className="font-display text-base leading-tight">Partners in Biz</span>
                {orgName && <span className="text-[11px] text-[var(--color-pib-text-muted)] truncate leading-tight mt-0.5">{orgName}</span>}
              </div>
              <span className="ml-auto pill !text-[10px] !py-0.5 !px-2 shrink-0">Client</span>
            </>
          )}
        </Link>

        {/* Collapse toggle (desktop only) */}
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={[
            'hidden md:flex items-center justify-center h-8 text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors border-b border-[var(--color-pib-line)] w-full',
            collapsed ? '' : 'px-5',
          ].join(' ')}
        >
          <span className="material-symbols-outlined text-[18px]">
            {collapsed ? 'chevron_right' : 'chevron_left'}
          </span>
          {!collapsed && <span className="ml-auto text-[10px] opacity-50">collapse</span>}
        </button>

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

        {/* Org switcher — only when client belongs to multiple workspaces */}
        {orgs.length > 1 && (
          <div className="border-t border-[var(--color-pib-line)] shrink-0">
            {collapsed ? (
              <div className="flex flex-col items-center gap-1 py-2 px-2">
                {orgs.map(org => (
                  <button
                    key={org.id}
                    onClick={() => handleOrgSwitch(org.id)}
                    disabled={orgSwitching}
                    title={org.name}
                    className={[
                      'w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold transition-colors',
                      org.id === activeOrgId
                        ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)] ring-1 ring-[var(--color-pib-accent)]/40'
                        : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.06]',
                    ].join(' ')}
                  >
                    {org.name[0]?.toUpperCase() ?? '·'}
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-3 py-3">
                <p className="eyebrow !text-[10px] px-1 mb-2">Workspace</p>
                <div className="space-y-0.5">
                  {orgs.map(org => (
                    <button
                      key={org.id}
                      onClick={() => handleOrgSwitch(org.id)}
                      disabled={orgSwitching}
                      className={[
                        'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left',
                        org.id === activeOrgId
                          ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]'
                          : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.04]',
                      ].join(' ')}
                    >
                      <span className={[
                        'w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0',
                        org.id === activeOrgId ? 'bg-[var(--color-pib-accent)]/20' : 'bg-[var(--color-pib-line-strong)]',
                      ].join(' ')}>
                        {org.name[0]?.toUpperCase() ?? '·'}
                      </span>
                      <span className="flex-1 truncate text-[13px]">{org.name}</span>
                      {org.id === activeOrgId && (
                        <span className="material-symbols-outlined text-[14px] text-[var(--color-pib-accent)]">check_circle</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* User chip */}
        <div className="border-t border-[var(--color-pib-line)] p-3 shrink-0">
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <Link
                href="/portal/settings/account"
                title="Settings"
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
                href="/portal/settings/account"
                title="Settings"
                className="w-8 h-8 rounded-full bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-line-strong)] flex items-center justify-center text-xs font-medium text-[var(--color-pib-accent-hover)] hover:ring-2 hover:ring-[var(--color-pib-accent)]/40 transition-all shrink-0"
              >
                {initials || '·'}
              </Link>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{profileName || name || 'Client'}</p>
                <p className="text-[11px] text-[var(--color-pib-text-muted)] truncate">{email}</p>
              </div>
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
            {/* Switch to topbar layout */}
            <button
              onClick={toggleLayout}
              title="Switch to topbar layout"
              className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05] transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">top_panel_open</span>
            </button>
            <SupportDrawer triggerClassName="hidden sm:inline-flex items-center gap-1.5 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors" />
          </div>
        </header>

        <main className="flex-1 px-4 md:px-8 py-8 max-w-6xl mx-auto w-full">{children}</main>

        <footer className="px-4 md:px-8 py-6 border-t border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] text-xs flex flex-wrap items-center justify-between gap-3">
          <span>© {new Date().getFullYear()} Partners in Biz · Pretoria</span>
          <div className="flex items-center gap-4">
            <Link href="/privacy-policy" className="hover:text-[var(--color-pib-text)] transition-colors">Privacy</Link>
            <Link href="/terms-of-service" className="hover:text-[var(--color-pib-text)] transition-colors">Terms</Link>
          </div>
        </footer>
      </div>
    </div>
  )
}
