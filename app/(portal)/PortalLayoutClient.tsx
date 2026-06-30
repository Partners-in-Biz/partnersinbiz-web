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
import { PortalSubnav, type PortalSubnavItem } from '@/components/navigation/PortalSubnav'
import { buildMarketingHubProps } from '@/components/navigation/marketingHubConfig'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { MessageDrawer } from '@/components/chat/MessageDrawer'
import { ThemedSelect } from '@/components/ui/ThemedSelect'
import { CommandPalette } from '@/components/command-palette/CommandPalette'
import { ShortcutsCheatSheet } from '@/components/command-palette/ShortcutsCheatSheet'
import { FeatureFlagsProvider } from '@/components/portal/FeatureFlagsProvider'
import { detectCurrentPageContext } from '@/lib/context-references/route-context'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import { resolvePortalModules, type PortalModules } from '@/lib/organizations/portal-modules'
import {
  canRoleUseModule,
  isOrganizationModulePolicyKey,
  resolveOrganizationModulePolicies,
  type OrganizationModulePolicies,
} from '@/lib/organizations/module-policies'
import {
  canAccessModule,
  normalizeMemberAccessPolicy,
  resolveMemberAccessPolicy,
  type MemberAccessPolicy,
  type WorkspaceModuleKey,
} from '@/lib/orgMembers/access-policy'

const PORTAL_MATERIAL_SYMBOLS =
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap'

interface NavItem {
  href: string
  label: string
  icon: string
  group: 'work' | 'data' | 'comms'
  activePatterns?: string[]
}

const NAV_LINKS: NavItem[] = [
  { href: '/portal/dashboard', label: 'Overview',  icon: 'space_dashboard', group: 'work' },
  { href: '/portal/briefings', label: 'Briefings', icon: 'team_dashboard', group: 'work' },
  { href: '/portal/projects',  label: 'Projects',  icon: 'rocket_launch',   group: 'work' },
  { href: '/portal/documents', label: 'Documents', icon: 'description',     group: 'work' },
  { href: '/portal/research',  label: 'Research',  icon: 'travel_explore', group: 'data' },
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
      '/portal/geo-seo',
      '/portal/creative-canvas',
      '/portal/book-studio',
      '/portal/youtube-studio',
      '/portal/mobile-apps',
      '/portal/capture-sources',
      '/portal/email-domains',
      '/portal/ads',
    ],
  },
  {
    href: '/portal/personal/marketing',
    label: 'Personal',
    icon: 'person',
    group: 'work',
    activePatterns: ['/portal/personal'],
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
    href: '/portal/settings/team',
    label: 'Settings',
    icon: 'settings',
    group: 'comms',
    activePatterns: ['/portal/settings'],
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

const NAV_MODULES: Partial<Record<string, WorkspaceModuleKey>> = {
  '/portal/projects': 'projects',
  '/portal/documents': 'documents',
  '/portal/research': 'research',
  '/portal/mobile-apps': 'mobileApps',
  '/portal/youtube-studio': 'youtubeStudio',
  '/portal/book-studio': 'bookStudio',
  '/portal/crm': 'crm',
  '/portal/marketing': 'marketing',
  '/portal/messages': 'messages',
  '/portal/email': 'email',
  '/portal/reports': 'reports',
  '/portal/properties': 'properties',
  '/portal/payments': 'billing',
}

const GROUP_LABELS: Record<NavItem['group'], string> = {
  work: 'Workspace',
  data: 'Insights',
  comms: 'Account',
}

const CRM_ROUTE_PATTERNS = [
  '/portal/crm',
  '/portal/contacts',
  '/portal/companies',
  '/portal/deals',
  '/portal/reports/crm',
  '/portal/segments',
  '/portal/capture-sources',
  '/portal/integrations',
  '/portal/email',
  '/portal/settings/crm-setup',
  '/portal/settings/custom-fields',
  '/portal/settings/pipelines',
  '/portal/settings/scoring',
  '/portal/settings/products',
  '/portal/settings/automations',
  '/portal/settings/sequences',
  '/portal/settings/webhooks',
]

const MARKETING_SECTION_ICONS: Record<string, string> = {
  'Brand and campaigns': 'campaign',
  'Social media': 'share',
  'Email and capture': 'mail',
  'Audience and setup': 'groups',
  Studio: 'design_services',
}

const PERSONAL_ROUTE_PATTERNS = [
  '/portal/personal',
]

const MARKETING_ROUTE_PATTERNS = [
  '/portal/marketing',
  '/portal/branding',
  '/portal/campaigns',
  '/portal/content-campaigns',
  '/portal/ads',
  '/portal/seo',
  '/portal/geo-seo',
  '/portal/creative-canvas',
  '/portal/book-studio',
  '/portal/youtube-studio',
  '/portal/mobile-apps',
  '/portal/social',
  '/portal/email-analytics',
  '/portal/email-domains',
  '/portal/communications',
]

type LayoutMode = 'sidebar' | 'topbar'

interface PortalOrgOption {
  id: string
  name: string
  slug: string
  type?: string
  logoUrl: string
  portalModules?: PortalModules
  modulePolicies?: OrganizationModulePolicies
}


function buildPersonalSubnavItems(): PortalSubnavItem[] {
  return [
    { label: 'Personal overview', href: '/portal/personal/marketing', icon: 'person' },
    { label: 'Compose', href: '/portal/personal/social/compose', icon: 'edit_square' },
    { label: 'Accounts', href: '/portal/personal/social/accounts', icon: 'add_link' },
    { label: 'Vault', href: '/portal/personal/social/vault', icon: 'folder' },
    { label: 'History', href: '/portal/personal/social/history', icon: 'history' },
    { label: 'Calendar', href: '/portal/personal/social/calendar', icon: 'calendar_month' },
    { label: 'Company social', href: '/portal/social', icon: 'business' },
  ]
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

type PortalUserPayload = {
  role?: unknown
  memberRole?: unknown
  accessPolicy?: unknown
  accessScope?: unknown
}

function portalRole(value: unknown): Parameters<typeof resolveMemberAccessPolicy>[0]['role'] {
  return value === 'owner' || value === 'admin' || value === 'member' || value === 'system' ? value : 'member'
}

function resolvePortalAccessPolicy(user: unknown): MemberAccessPolicy {
  const payload = user && typeof user === 'object' ? user as PortalUserPayload : {}
  return resolveMemberAccessPolicy({
    role: portalRole(payload.memberRole ?? payload.role),
    accessPolicy: payload.accessPolicy,
    accessScope: payload.accessScope,
  })
}

function NavLink({ item, pathname, collapsed }: { item: NavItem; pathname: string; collapsed?: boolean }) {
  const on = active(pathname, item)
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
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
    </Link>
  )
}

function buildCrmSubnavItems(buildHref: (path: string) => string): PortalSubnavItem[] {
  return [
    {
      label: 'Contacts',
      href: buildHref('/portal/contacts'),
      icon: 'contacts',
    },
    {
      label: 'Companies',
      href: buildHref('/portal/companies'),
      icon: 'domain',
    },
    {
      label: 'Deals',
      href: buildHref('/portal/deals'),
      icon: 'monetization_on',
    },
    {
      label: 'CRM Reports',
      href: buildHref('/portal/reports/crm'),
      icon: 'query_stats',
    },
    {
      label: 'Capture & Comms',
      href: buildHref('/portal/segments'),
      icon: 'campaign',
      activePatterns: ['/portal/segments', '/portal/capture-sources', '/portal/integrations', '/portal/email'],
      children: [
        { label: 'Segments', href: buildHref('/portal/segments'), icon: 'group_work' },
        { label: 'Capture sources', href: buildHref('/portal/capture-sources'), icon: 'inventory_2' },
        { label: 'Integrations', href: buildHref('/portal/integrations'), icon: 'extension' },
        { label: 'Email', href: buildHref('/portal/email'), icon: 'mail' },
      ],
    },
    {
      label: 'Config',
      href: buildHref('/portal/settings/crm-setup'),
      icon: 'settings',
      activePatterns: [
        '/portal/settings/crm-setup',
        '/portal/settings/pipelines',
        '/portal/settings/custom-fields',
        '/portal/settings/scoring',
        '/portal/settings/products',
        '/portal/settings/automations',
        '/portal/settings/sequences',
        '/portal/settings/webhooks',
      ],
      children: [
        { label: 'CRM setup', href: buildHref('/portal/settings/crm-setup'), icon: 'rocket_launch' },
        { label: 'Pipelines', href: buildHref('/portal/settings/pipelines'), icon: 'sync_alt' },
        { label: 'Custom fields', href: buildHref('/portal/settings/custom-fields'), icon: 'tune' },
        { label: 'Scoring', href: buildHref('/portal/settings/scoring'), icon: 'star_rate' },
        { label: 'Products', href: buildHref('/portal/settings/products'), icon: 'inventory' },
        { label: 'Automations', href: buildHref('/portal/settings/automations'), icon: 'bolt' },
        { label: 'Sequences', href: buildHref('/portal/settings/sequences'), icon: 'route' },
        { label: 'Webhooks', href: buildHref('/portal/settings/webhooks'), icon: 'webhook' },
      ],
    },
  ]
}

function buildMarketingSubnavItems(config: {
  orgId?: string
  orgSlug?: string
  sourceCompanyId?: string
  sourceCompanyName?: string
}, buildHref: (path: string) => string): PortalSubnavItem[] {
  const marketingHub = buildMarketingHubProps({ surface: 'portal', ...config })
  const sectionItems = marketingHub.sections.map((section) => {
    const firstAction = section.actions[0]
    return {
      label: section.title,
      href: firstAction?.href ?? '/portal/marketing',
      icon: MARKETING_SECTION_ICONS[section.title] ?? firstAction?.icon,
      activePatterns: section.actions.map((action) => action.href.split('?')[0] ?? action.href),
      children: section.actions.map((action) => ({
        label: action.label,
        href: action.href,
        icon: action.icon,
      })),
    }
  })
  return [
    ...sectionItems,
    {
      label: 'Studio',
      href: buildHref('/portal/creative-canvas'),
      icon: MARKETING_SECTION_ICONS.Studio,
      activePatterns: ['/portal/creative-canvas', '/portal/book-studio', '/portal/youtube-studio', '/portal/mobile-apps'],
      children: [
        { label: 'Marketing Studio', href: buildHref('/portal/creative-canvas'), icon: 'draw' },
        { label: 'Book Studio', href: buildHref('/portal/book-studio'), icon: 'auto_stories' },
        { label: 'YouTube Studio', href: buildHref('/portal/youtube-studio'), icon: 'smart_display' },
        { label: 'Mobile Apps', href: buildHref('/portal/mobile-apps'), icon: 'smartphone' },
      ],
    },
  ]
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
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
    </ThemeProvider>
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
  const isCockpitRoute = pathname === '/portal/briefings' || pathname.startsWith('/portal/briefings/')
  const isWorkspaceRoute = isEmailRoute || isMessagesRoute

  const [email, setEmail]       = useState('')
  const [name, setName]         = useState('')
  const [uid, setUid]           = useState('')
  const [orgName, setOrgName]   = useState('')
  const [checking, setChecking] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed]   = useState(false)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('sidebar')
  const [orgs, setOrgs] = useState<PortalOrgOption[]>([])
  const [activeOrgId, setActiveOrgId] = useState('')
  const [activeOrgSlug, setActiveOrgSlug] = useState('')
  const [activeOrgType, setActiveOrgType] = useState('')
  const [portalModules, setPortalModules] = useState<PortalModules>(() => resolvePortalModules(undefined))
  const [modulePolicies, setModulePolicies] = useState<OrganizationModulePolicies>(() => resolveOrganizationModulePolicies(undefined))
  const [userRole, setUserRole] = useState('')
  const [orgSwitching, setOrgSwitching] = useState(false)
  const [memberRole, setMemberRole] = useState<string | null>(null)
  const [memberAccessPolicy, setMemberAccessPolicy] = useState<MemberAccessPolicy>(() => normalizeMemberAccessPolicy(null))
  const [profileName, setProfileName] = useState('')
  const [cmdOpen, setCmdOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [changelogUnread, setChangelogUnread] = useState(0)
  const [featureFlags, setFeatureFlags] = useState({
    show_ai_features: true,
    show_creative_canvas: true,
    enable_social_listening: false,
    show_whatsapp: false,
  })

  // Keyboard shortcuts: Cmd+K (palette), Cmd+S (save event), ? (cheat sheet),
  // and G-prefix nav sequences (G then D/C/E/S/O).
  useEffect(() => {
    let gPrefixUntil = 0

    function isTyping(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null
      if (!el) return false
      const tag = el.tagName
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable === true
      )
    }

    function handler(e: KeyboardEvent) {
      const metaOrCtrl = e.metaKey || e.ctrlKey

      // Cmd/Ctrl+K — command palette (works even while typing).
      if (metaOrCtrl && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdOpen(v => !v)
        return
      }

      // Cmd/Ctrl+S — broadcast a save event for form pages to listen on.
      if (metaOrCtrl && e.key.toLowerCase() === 's') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('pib:save'))
        return
      }

      // The rest are single-key shortcuts: ignore when typing or modifiers held.
      if (metaOrCtrl || e.altKey || isTyping(e.target)) return

      // ? — open the shortcuts cheat sheet.
      if (e.key === '?') {
        e.preventDefault()
        setShortcutsOpen(true)
        return
      }

      // G-prefix nav sequence.
      const now = Date.now()
      if (e.key.toLowerCase() === 'g') {
        gPrefixUntil = now + 1500
        return
      }
      if (now <= gPrefixUntil) {
        const dest: Record<string, string> = {
          d: '/portal/dashboard',
          c: '/portal/crm',
          e: '/portal/email',
          s: '/portal/social',
          o: '/portal/settings/organization',
        }
        const href = dest[e.key.toLowerCase()]
        gPrefixUntil = 0
        if (href) {
          e.preventDefault()
          router.push(href)
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [router])

  // Changelog unread count for the "What's new" badge.
  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/portal/changelog')
      .then(r => (r.ok ? r.json() : null))
      .then(body => {
        if (cancelled) return
        const count = (body?.data ?? body)?.unreadCount
        if (typeof count === 'number') setChangelogUnread(count)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // US-211: feature flags for the active org (drives nav gating).
  useEffect(() => {
    let cancelled = false
    const url = activeOrgId
      ? `/api/v1/org/feature-flags?orgId=${encodeURIComponent(activeOrgId)}`
      : '/api/v1/org/feature-flags'
    fetch(url)
      .then(r => (r.ok ? r.json() : null))
      .then(body => {
        if (cancelled) return
        const flags = (body?.data ?? body)?.flags
        if (flags && typeof flags === 'object') {
          setFeatureFlags(prev => ({ ...prev, ...flags }))
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [activeOrgId])

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
              if (d?.org) {
                setPortalModules(resolvePortalModules({ portalModules: d.org.portalModules }))
                setModulePolicies(resolveOrganizationModulePolicies({ modulePolicies: d.org.modulePolicies }))
              }
              if (d?.user?.role) setUserRole(d.user.role)
              if (d?.user?.memberRole) setMemberRole(d.user.memberRole)
              if (d?.user) setMemberAccessPolicy(resolvePortalAccessPolicy(d.user))
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
              if (activeOrg?.portalModules) setPortalModules(resolvePortalModules({ portalModules: activeOrg.portalModules }))
              if (activeOrg?.modulePolicies) setModulePolicies(resolveOrganizationModulePolicies({ modulePolicies: activeOrg.modulePolicies }))
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
              if (d?.profile?.role) setMemberRole((current) => current ?? d.profile.role)
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
        if (switched.portalModules) setPortalModules(resolvePortalModules({ portalModules: switched.portalModules }))
        if (switched.modulePolicies) setModulePolicies(resolveOrganizationModulePolicies({ modulePolicies: switched.modulePolicies }))
      }
      router.push(scopedPortalHref(pathname, orgId, switched?.slug ?? ''))
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

  const canManageTeamSettings = memberRole === 'owner' || memberRole === 'admin'
  // US-207: client-role users get a stripped-down sidebar — Dashboard, Reports,
  // Documents only.
  const effectiveRole = memberRole || userRole
  const isClientRole = effectiveRole === 'client'
  const CLIENT_ALLOWED_HREFS = new Set(['/portal/dashboard', '/portal/reports', '/portal/documents', '/portal/personal/marketing'])
  const visibleNavLinks = NAV_LINKS.filter((item) => {
    if (isClientRole) return CLIENT_ALLOWED_HREFS.has(item.href)
    const moduleKey = NAV_MODULES[item.href]
    if (moduleKey && !canAccessModule(memberAccessPolicy, moduleKey)) return false
    if (isOrganizationModulePolicyKey(moduleKey) && !canRoleUseModule(modulePolicies, moduleKey, memberRole || userRole)) return false
    if (item.href === '/portal/settings/team' && !canManageTeamSettings) return false
    if (item.href === '/portal/mobile-apps') return portalModules.mobileApps
    if (item.href === '/portal/youtube-studio') return portalModules.youtubeStudio
    if (item.href === '/portal/book-studio') return portalModules.bookStudio
    // US-211: gate the AI-features Research entry behind the show_ai_features flag.
    if (item.href === '/portal/research') return featureFlags.show_ai_features
    return true
  })
  const navItems: NavItem[] = visibleNavLinks.map((item) => {
    const href = requestedOrgId
      ? scopedShellHref(item.href)
      : item.href
    return { ...item, href }
  })

  const grouped = (['work', 'data', 'comms'] as const).map(g => ({
    group: g,
    items: navItems.filter(n => n.group === g),
  }))
  const requestedWorkspaceOption: PortalOrgOption | null = activeOrgId && orgName && !orgs.some(org => org.id === activeOrgId)
    ? {
        id: activeOrgId,
        name: orgName,
        slug: activeOrgSlug || requestedOrgSlug,
        type: activeOrgType,
        logoUrl: '',
        portalModules,
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
  const crmSubnavItems = buildCrmSubnavItems(scopedShellHref)
  const marketingSubnavItems = buildMarketingSubnavItems({
    orgId: requestedOrgId,
    orgSlug: requestedOrgSlug || activeOrgSlug,
    sourceCompanyId: requestedSourceCompanyId,
    sourceCompanyName: requestedSourceCompanyName,
  }, scopedShellHref)
  const personalSubnavItems = buildPersonalSubnavItems()
  const showPersonalSubnav = PERSONAL_ROUTE_PATTERNS.some((pattern) => pathname === pattern || pathname.startsWith(pattern + '/'))
  const showCrmSubnav = CRM_ROUTE_PATTERNS.some((pattern) => pathname === pattern || pathname.startsWith(pattern + '/'))
  const showMarketingSubnav = MARKETING_ROUTE_PATTERNS.some((pattern) => pathname === pattern || pathname.startsWith(pattern + '/'))
  const areaSubnav = showPersonalSubnav ? (
    <PortalSubnav ariaLabel="Personal marketing workspace navigation" items={personalSubnavItems} pathname={pathname} />
  ) : showMarketingSubnav ? (
    <PortalSubnav ariaLabel="Marketing workspace navigation" items={marketingSubnavItems} pathname={pathname} />
  ) : showCrmSubnav ? (
    <PortalSubnav ariaLabel="CRM workspace navigation" items={crmSubnavItems} pathname={pathname} />
  ) : null

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

            <button
              type="button"
              onClick={() => router.back()}
              aria-label="Go back"
              title="Go back"
              className="hidden sm:inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>
            </button>

            <div className="w-px h-5 bg-[var(--color-pib-line)] shrink-0 hidden md:block" />

            {/* Nav — scrollable */}
            <nav className="hidden md:flex items-center gap-0.5 overflow-x-auto scrollbar-none flex-1 min-w-0">
              {navItems.map(item => {
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
              <Link href={scopedShellHref("/portal/changelog")} title="What's new" aria-label="What's new" className="relative flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05]"><span className="material-symbols-outlined text-[20px]">campaign</span>{changelogUnread > 0 && (<span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-pib-accent)] text-[10px] font-semibold text-white flex items-center justify-center">{changelogUnread > 9 ? "9+" : changelogUnread}</span>)}</Link>
              <button onClick={() => setCmdOpen(true)} title="Search (⌘K)" className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05]">
                <span className="material-symbols-outlined text-[20px]">search</span>
              </button>
              <ThemeToggle />
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
              {navItems.map(item => {
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

        {areaSubnav}

        <main className={isCockpitRoute
          ? 'flex-1 min-h-0 overflow-hidden w-full max-w-none'
          : isWorkspaceRoute
          ? 'flex-1 min-h-0 overflow-hidden px-3 md:px-5 py-4 w-full max-w-none'
          : 'flex-1 overflow-y-auto px-4 md:px-8 py-8 max-w-[1400px] mx-auto w-full'
        }><FeatureFlagsProvider orgId={activeOrgId}>{children}</FeatureFlagsProvider></main>

        {!isWorkspaceRoute && !isCockpitRoute && (
          <footer className="px-4 md:px-8 py-6 border-t border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] text-xs flex flex-wrap items-center justify-between gap-3">
            <span>© {new Date().getFullYear()} Partners in Biz · Pretoria</span>
            <div className="flex items-center gap-4">
              <Link href="/privacy-policy" className="hover:text-[var(--color-pib-text)] transition-colors">Privacy</Link>
              <Link href="/terms-of-service" className="hover:text-[var(--color-pib-text)] transition-colors">Terms</Link>
            </div>
          </footer>
        )}
        <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
        <ShortcutsCheatSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
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
                <ThemedSelect
                  id="portal-workspace-switcher"
                  ariaLabel="Switch portal workspace"
                  value={activeOrgId}
                  options={workspaceOptions.map(org => ({ value: org.id, label: org.name }))}
                  onValueChange={handleOrgSwitch}
                  disabled={orgSwitching}
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
            collapsed={collapsed}
          />
        ) : (
          <nav className={['flex-1 overflow-y-auto py-4', collapsed ? 'px-2 space-y-1' : 'px-3 space-y-5'].join(' ')}>
            {collapsed
              ? navItems.map(item => <NavLink key={item.href} item={item} pathname={pathname} collapsed />)
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
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Go back"
            title="Go back"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>
          </button>
          <span className="eyebrow !text-[10px]">Client portal</span>
          <span className="hidden sm:inline w-1 h-1 rounded-full bg-[var(--color-pib-line-strong)]" />
          <span className="hidden sm:inline text-xs text-[var(--color-pib-text-muted)]">
            {visibleNavLinks.find(n => active(pathname, n))?.label ?? 'Overview'}
          </span>
          <div className="ml-auto flex items-center gap-3">
            {canOpenAdminView && (
              <Link
                href={adminViewHref}
                title="Switch to admin view"
                className="hidden md:flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05] transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">person</span>
              </Link>
            )}
            <Link href={scopedShellHref("/portal/changelog")} title="What's new" aria-label="What's new" className="relative flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05]"><span className="material-symbols-outlined text-[20px]">campaign</span>{changelogUnread > 0 && (<span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-pib-accent)] text-[10px] font-semibold text-white flex items-center justify-center">{changelogUnread > 9 ? "9+" : changelogUnread}</span>)}</Link>
              <button onClick={() => setCmdOpen(true)} title="Search (⌘K)" className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.05]">
              <span className="material-symbols-outlined text-[20px]">search</span>
            </button>
            <ThemeToggle />
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

        {areaSubnav}

        <main className={isCockpitRoute
          ? 'flex-1 min-h-0 overflow-hidden w-full max-w-none'
          : isWorkspaceRoute
          ? 'flex-1 min-h-0 overflow-hidden px-3 md:px-5 py-4 w-full max-w-none'
          : 'flex-1 overflow-y-auto px-4 md:px-8 py-8 max-w-[1400px] mx-auto w-full'
        }><FeatureFlagsProvider orgId={activeOrgId}>{children}</FeatureFlagsProvider></main>

        {!isWorkspaceRoute && !isCockpitRoute && (
          <footer className="px-4 md:px-8 py-6 border-t border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] text-xs flex flex-wrap items-center justify-between gap-3">
            <span>© {new Date().getFullYear()} Partners in Biz · Pretoria</span>
            <div className="flex items-center gap-4">
              <Link href="/privacy-policy" className="hover:text-[var(--color-pib-text)] transition-colors">Privacy</Link>
              <Link href="/terms-of-service" className="hover:text-[var(--color-pib-text)] transition-colors">Terms</Link>
            </div>
          </footer>
        )}
      </div>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
        <ShortcutsCheatSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      </div>
    </>
  )
}
