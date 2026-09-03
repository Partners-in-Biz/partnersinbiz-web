'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, getClientAuth } from '@/lib/firebase/config'
import { logout } from '@/lib/firebase/auth'
import { LastPathTracker } from '@/components/pwa/LastPathTracker'
import { clearLastPath } from '@/lib/pwa/lastPath'
import { WelcomeFlashHandler } from '@/components/ui/WelcomeFlashHandler'
import { PortalSubnav, type PortalSubnavItem } from '@/components/navigation/PortalSubnav'
import { buildMarketingHubProps } from '@/components/navigation/marketingHubConfig'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { CommandPalette } from '@/components/command-palette/CommandPalette'
import { ShortcutsCheatSheet } from '@/components/command-palette/ShortcutsCheatSheet'
import { FeatureFlagsProvider } from '@/components/portal/FeatureFlagsProvider'
import {
  PortalSidebar,
  PortalTopbar,
  PortalFooter,
  isPortalNavActive,
  type PortalNavItem,
} from '@/components/portal/shell'
import { BotModeChromeToggle } from '@/components/messages/bot-mode/BotModeChromeToggle'
import { BotModeImmersiveShell } from '@/components/messages/bot-mode/BotModeImmersiveShell'
import { shouldHideSiteChrome } from '@/lib/messages/bot-mode-chrome'
import { detectCurrentPageContext } from '@/lib/context-references/route-context'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import { resolvePortalModules, type PortalModules } from '@/lib/organizations/portal-modules'
import {
  canRoleUseModule,
  canRolePerformModuleAction,
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

type NavItem = PortalNavItem

const NAV_LINKS: NavItem[] = [
  { href: '/portal/dashboard', label: 'Overview',  icon: 'space_dashboard', group: 'work' },
  { href: '/portal/briefings', label: 'Briefings', icon: 'radar', group: 'work' },
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
      '/portal/partners',
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
      '/portal/video-editor',
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
  { href: '/portal/finance', label: 'Finance', icon: 'account_balance', group: 'comms', activePatterns: ['/portal/finance', '/portal/payments', '/portal/invoicing', '/portal/billing'] },
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
  '/portal/finance': 'billing',
  '/portal/invoicing': 'billing',
  '/portal/billing': 'billing',
  // CRM configuration pages are gated by the dedicated configuration module so
  // members never see pipelines/scoring/products/automation setup unless the
  // owner explicitly grants them.
  '/portal/settings/crm-setup': 'configuration',
  '/portal/settings/pipelines': 'configuration',
  '/portal/settings/custom-fields': 'configuration',
  '/portal/settings/scoring': 'configuration',
  '/portal/settings/products': 'configuration',
  '/portal/settings/automations': 'configuration',
  '/portal/settings/sequences': 'configuration',
  '/portal/settings/webhooks': 'configuration',
}

const CRM_ROUTE_PATTERNS = [
  '/portal/crm',
  '/portal/contacts',
  '/portal/companies',
  '/portal/deals',
  '/portal/partners',
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
  '/portal/video-editor',
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
    { label: 'Campaigns', href: '/portal/personal/campaigns', icon: 'flag' },
    { label: 'Accounts', href: '/portal/personal/social/accounts', icon: 'add_link' },
    { label: 'Vault', href: '/portal/personal/social/vault', icon: 'folder' },
    { label: 'History', href: '/portal/personal/social/history', icon: 'history' },
    { label: 'Calendar', href: '/portal/personal/social/calendar', icon: 'calendar_month' },
  ]
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
      label: 'Partners',
      href: buildHref('/portal/partners'),
      icon: 'handshake',
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

function filterSubnavByAccess(
  items: PortalSubnavItem[],
  access: {
    memberAccessPolicy: MemberAccessPolicy
    modulePolicies: OrganizationModulePolicies
    role: string
  },
): PortalSubnavItem[] {
  const { memberAccessPolicy, modulePolicies, role } = access
  const canSeeHref = (href: string) => {
    const hrefPath = href.split('?')[0] ?? href
    const moduleKey = NAV_MODULES[hrefPath]
    if (!moduleKey) return true
    if (!canAccessModule(memberAccessPolicy, moduleKey)) return false
    if (isOrganizationModulePolicyKey(moduleKey) && !canRoleUseModule(modulePolicies, moduleKey, role)) return false
    return true
  }
  return items
    .map((item): PortalSubnavItem | null => {
      const children = item.children ? item.children.filter((child) => canSeeHref(child.href)) : undefined
      const visible = canSeeHref(item.href)
      if (!visible && (!children || children.length === 0)) return null
      return { ...item, children }
    })
    .filter((item): item is PortalSubnavItem => item !== null)
}

function buildMarketingSubnavItems(config: {
  orgId?: string
  orgSlug?: string
  sourceCompanyId?: string
  sourceCompanyName?: string
}, buildHref: (path: string) => string): PortalSubnavItem[] {
  const marketingHub = buildMarketingHubProps({ surface: 'portal', ...config })
  const sectionItems = marketingHub.sections
    .filter((section) => section.title !== 'Personal workspace')
    .map((section) => {
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
      activePatterns: ['/portal/creative-canvas', '/portal/video-editor', '/portal/book-studio', '/portal/youtube-studio', '/portal/mobile-apps'],
      children: [
        { label: 'Marketing Studio', href: buildHref('/portal/creative-canvas'), icon: 'draw' },
        { label: 'Video Editor', href: buildHref('/portal/video-editor'), icon: 'movie_edit' },
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
            <div className="min-h-screen bg-[var(--sc-canvas)] flex items-center justify-center">
              <span className="st-status st-status--info sc-tiny" aria-live="polite">Loading</span>
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
  const isConversationsRoute = pathname === '/portal/conversations' || pathname.startsWith('/portal/conversations/')
  const isCockpitRoute = pathname === '/portal/briefings' || pathname.startsWith('/portal/briefings/')
  const isCreativeCanvasRoute = pathname === '/portal/creative-canvas' || pathname.startsWith('/portal/creative-canvas/')
  // Project detail boards need the full content width so all kanban columns fit.
  const isProjectDetailRoute = /\/portal\/projects\/[^/]+/.test(pathname) || /\/portal\/project\/[^/]+/.test(pathname)
  const isProjectsListRoute = pathname === '/portal/projects' || pathname === '/portal/project'
  const isWorkspaceRoute = isEmailRoute || isMessagesRoute || isConversationsRoute || isCreativeCanvasRoute || isProjectDetailRoute

  const [email, setEmail]       = useState('')
  const [name, setName]         = useState('')
  const [uid, setUid]           = useState('')
  const [orgName, setOrgName]   = useState('')
  const [checking, setChecking] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed]   = useState(false)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('sidebar')
  const [orgs, setOrgs] = useState<PortalOrgOption[]>([])
  const [orgsLoaded, setOrgsLoaded] = useState(false)
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
  const [chromeRevealed, setChromeRevealed] = useState(false)
  const botModeParam = searchParams.get('mode')

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

      // Cmd/Ctrl+K  -  command palette (works even while typing).
      if (metaOrCtrl && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdOpen(v => !v)
        return
      }

      // Cmd/Ctrl+S  -  broadcast a save event for form pages to listen on.
      if (metaOrCtrl && e.key.toLowerCase() === 's') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('pib:save'))
        return
      }

      // The rest are single-key shortcuts: ignore when typing or modifiers held.
      if (metaOrCtrl || e.altKey || isTyping(e.target)) return

      // ?  -  open the shortcuts cheat sheet.
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
            .finally(() => {
              if (!cancelled) setOrgsLoaded(true)
            })
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

  useEffect(() => {
    if (botModeParam !== 'bot') setChromeRevealed(false)
  }, [botModeParam])

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
      const res = await fetch('/api/v1/portal/active-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const message =
          typeof body?.error === 'string' && body.error.trim()
            ? body.error.trim()
            : `Could not switch workspace (${res.status})`
        window.alert(message)
        return
      }
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
        <div className="min-h-screen bg-[var(--sc-canvas)] flex items-center justify-center">
          <span className="st-status st-status--info sc-tiny" aria-live="polite">Loading</span>
        </div>
      </>
    )
  }

  // Always carry the selected workspace on shell links. URL orgId wins when
  // present; otherwise use the active workspace the switcher already resolved.
  // Previously only URL-scoped navigations kept orgId, so pages like Messages
  // and Agent org chart re-resolved a stale Firestore activeOrgId (e.g. a UAT
  // org) while the switcher still showed Partners in Biz.
  const shellOrgId = requestedOrgId || activeOrgId
  const shellOrgSlug = requestedOrgSlug || activeOrgSlug
  const scopedShellHref = (path: string) =>
    shellOrgId
      ? scopedPortalHref(
          path,
          shellOrgId,
          shellOrgSlug,
          requestedSourceCompanyId,
          requestedSourceCompanyName,
        )
      : path

  const canManageTeamSettings = memberRole === 'owner' || memberRole === 'admin'
  // US-207: client-role users get a stripped-down sidebar  -  Dashboard, Reports,
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
    // Wiki holds workspace knowledge notes and agent activity logs  -  owner/admin only.
    if (item.href === '/portal/wiki' && !canManageTeamSettings) return false
    if (item.href === '/portal/mobile-apps') return portalModules.mobileApps
    if (item.href === '/portal/youtube-studio') return portalModules.youtubeStudio
    if (item.href === '/portal/book-studio') return portalModules.bookStudio
    // US-211: gate the AI-features Research entry behind the show_ai_features flag.
    if (item.href === '/portal/research') return featureFlags.show_ai_features
    return true
  })
  const navItems: NavItem[] = visibleNavLinks.map((item) => {
    const href = shellOrgId ? scopedShellHref(item.href) : item.href
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
  const workspaceOptions = (requestedWorkspaceOption ? [requestedWorkspaceOption, ...orgs] : orgs).filter(
    (org, index, list) => org.id && list.findIndex((candidate) => candidate.id === org.id) === index,
  )
  const workspaceSwitcherLocked = orgSwitching || (orgsLoaded && workspaceOptions.length <= 1)

  const initials = (name || email).split(/[.\s@]/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('')
  const canOpenAdminView = userRole === 'admin' && !!activeOrgSlug
  const adminViewHref = activeOrgSlug ? `/admin/org/${activeOrgSlug}/dashboard` : '/admin/dashboard'
  const allowAgentParticipants = canRolePerformModuleAction(
    modulePolicies,
    'messages',
    'agentHandoff',
    effectiveRole,
  )
  const portalWorkspaceLabel = activeOrgType === 'platform_owner' || activeOrgId === PIB_PLATFORM_ORG_ID ? 'Platform' : 'Client'
  const currentPageContext = detectCurrentPageContext({
    pathname,
    searchParams,
    orgId: activeOrgId,
  })
  const subnavAccess = { memberAccessPolicy, modulePolicies, role: memberRole || userRole }
  const crmSubnavItems = filterSubnavByAccess(buildCrmSubnavItems(scopedShellHref), subnavAccess)
  const marketingSubnavItems = filterSubnavByAccess(buildMarketingSubnavItems({
    orgId: requestedOrgId,
    orgSlug: requestedOrgSlug || activeOrgSlug,
    sourceCompanyId: requestedSourceCompanyId,
    sourceCompanyName: requestedSourceCompanyName,
  }, scopedShellHref), subnavAccess)
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

  const hideSiteChrome = shouldHideSiteChrome({
    pathname,
    mode: botModeParam,
    chromeRevealed,
  })
  const botModeChrome = isMessagesRoute && botModeParam === 'bot'
  const revealedChromeToggle = botModeChrome && chromeRevealed ? (
    <BotModeChromeToggle revealed onToggle={() => setChromeRevealed(false)} />
  ) : null

  if (hideSiteChrome) {
    return (
      <>
        <link rel="stylesheet" href={PORTAL_MATERIAL_SYMBOLS} />
        <BotModeImmersiveShell onShowChrome={() => setChromeRevealed(true)}>
          {tracker}
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <FeatureFlagsProvider orgId={activeOrgId}>{children}</FeatureFlagsProvider>
          </main>
          <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
          <ShortcutsCheatSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        </BotModeImmersiveShell>
      </>
    )
  }

  const pageLabel = visibleNavLinks.find(n => isPortalNavActive(pathname, n))?.label ?? 'Overview'
  const dashboardHref = scopedShellHref('/portal/dashboard')
  const changelogHref = scopedShellHref('/portal/changelog')
  const profileHref = scopedShellHref('/portal/settings/profile')
  const displayName = profileName || name || email
  const canAccessConfiguration = canAccessModule(memberAccessPolicy, 'configuration')
  const mainClassName = isCockpitRoute
    ? 'flex-1 min-h-0 overflow-hidden w-full max-w-none'
    : isMessagesRoute
    ? 'flex-1 min-h-0 overflow-hidden p-[calc(var(--sc-u)*1)] w-full max-w-none'
    : isWorkspaceRoute
    ? 'flex-1 min-h-0 overflow-hidden p-[var(--sc-pad)] w-full max-w-none'
    : isProjectsListRoute
    ? 'flex-1 overflow-y-auto pib-app-shell-main w-full max-w-none'
    : 'flex-1 overflow-y-auto pib-app-shell-main max-w-[1400px] mx-auto w-full'

  const topbarShared = {
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
    onOrgSwitch: handleOrgSwitch,
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
    onOpenDrawer: () => setDrawerOpen(true),
    onCloseDrawer: () => setDrawerOpen(false),
    onToggleDrawer: () => setDrawerOpen(v => !v),
    onBack: () => router.back(),
    onOpenCommandPalette: () => setCmdOpen(true),
    onToggleLayout: toggleLayout,
    onLogout: handleLogout,
  }

  // Legal links (/privacy-policy, /terms-of-service) render via PortalFooter.
  // ── Topbar mode ────────────────────────────────────────────────────────────
  if (layoutMode === 'topbar') {
    return (
      <>
        <link rel="stylesheet" href={PORTAL_MATERIAL_SYMBOLS} />
        <div data-message-push-root className={[
          'flex flex-col bg-[var(--sc-canvas)] text-[var(--sc-ink)]',
          isCockpitRoute || isMessagesRoute ? 'h-dvh overflow-hidden' : 'min-h-screen',
        ].join(' ')}>
          {tracker}
          {revealedChromeToggle}
          <PortalTopbar variant="topbar" {...topbarShared} />
          {areaSubnav}
          <main className={mainClassName}><FeatureFlagsProvider orgId={activeOrgId}>{children}</FeatureFlagsProvider></main>
          {!isWorkspaceRoute && !isCockpitRoute && <PortalFooter />}
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
      <div data-message-push-root className={[
        'bg-[var(--sc-canvas)] text-[var(--sc-ink)] flex',
        isCockpitRoute || isMessagesRoute ? 'h-dvh overflow-hidden' : 'min-h-screen',
      ].join(' ')}>
        {tracker}
        {revealedChromeToggle}
        <PortalSidebar
          pathname={pathname}
          collapsed={collapsed}
          drawerOpen={drawerOpen}
          onCloseDrawer={() => setDrawerOpen(false)}
          onToggleCollapsed={toggleCollapsed}
          dashboardHref={dashboardHref}
          orgName={orgName}
          portalWorkspaceLabel={portalWorkspaceLabel}
          canOpenAdminView={canOpenAdminView}
          adminViewHref={adminViewHref}
          workspaceOptions={workspaceOptions}
          activeOrgId={activeOrgId}
          workspaceSwitcherLocked={workspaceSwitcherLocked}
          onOrgSwitch={handleOrgSwitch}
          navItems={navItems}
          grouped={grouped}
          profileName={profileName}
          name={name}
          email={email}
          initials={initials}
          profileHref={profileHref}
          memberRole={memberRole}
          canAccessConfiguration={canAccessConfiguration}
          onLogout={handleLogout}
        />
        <div className="flex-1 min-w-0 flex flex-col">
          <PortalTopbar variant="sidebar" {...topbarShared} />
          {areaSubnav}
          <main className={mainClassName}><FeatureFlagsProvider orgId={activeOrgId}>{children}</FeatureFlagsProvider></main>
          {!isWorkspaceRoute && !isCockpitRoute && <PortalFooter />}
        </div>
        <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
        <ShortcutsCheatSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      </div>
    </>
  )
}
