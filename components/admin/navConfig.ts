export interface SubLink {
  label: string
  href: string
}

export interface NavItem {
  label: string
  href: string
  icon: string
  group?: 'work' | 'data' | 'comms'
  children?: SubLink[]
  activePatterns?: string[]
}

// ── Operator nav (platform control plane only) ──────────────────────────────
// Top-level admin navigation shows only PiB operator control-plane routes.
// Workspace links stay on admin/org routes so operators do not fall into client-facing portal flows.

export const OPERATOR_NAV: NavItem[] = [
  { label: 'Home',            href: '/admin/dashboard',    icon: 'space_dashboard', group: 'work' },
  { label: 'Mission Control', href: '/admin/briefings',    icon: 'crisis_alert',    group: 'work' },
  { label: 'Updates',         href: '/admin/updates',      icon: 'new_releases',    group: 'work', activePatterns: ['/admin/announcements', '/admin/changelog'] },
  { label: 'Loop Engine',     href: '/admin/loop-engine',  icon: 'all_inclusive',   group: 'work' },
  { label: 'Organisations', href: '/admin/organizations', icon: 'groups', group: 'work', activePatterns: ['/admin/organizations', '/admin/org'] },
  { label: 'Onboarding', href: '/admin/onboarding', icon: 'how_to_reg', group: 'work' },
  { label: 'Demo Orgs', href: '/admin/demo-orgs', icon: 'science', group: 'work' },
  { label: 'Billing', href: '/admin/billing/revenue', icon: 'payments', group: 'data', activePatterns: ['/admin/billing', '/admin/plans', '/admin/partners'] },
  { label: 'Agents',   href: '/admin/agents',   icon: 'group_work', group: 'work', activePatterns: ['/admin/agents', '/admin/hermes'] },
  { label: 'Skill Lab', href: '/admin/skill-lab', icon: 'science', group: 'data' },
  { label: 'Content', href: '/admin/content/seo', icon: 'article', group: 'data', activePatterns: ['/admin/content'] },
  { label: 'Knowledge', href: '/admin/knowledge', icon: 'menu_book', group: 'data' },
  { label: 'Support',   href: '/admin/support',   icon: 'support_agent', group: 'comms' },
  { label: 'Settings', href: '/admin/settings', icon: 'settings', group: 'comms', activePatterns: ['/admin/platform-users', '/admin/platform-members', '/admin/properties', '/admin/moderation', '/admin/domains', '/admin/analytics', '/admin/reports', '/admin/tools', '/admin/system/audit-log', '/admin/settings/social-credentials', '/admin/2fa'] },
]

export const OPERATOR_NAV_TOPBAR: NavItem[] = [
  { label: 'Home',            href: '/admin/dashboard',    icon: 'space_dashboard' },
  { label: 'Mission Control', href: '/admin/briefings',    icon: 'crisis_alert' },
  { label: 'Updates',         href: '/admin/updates',      icon: 'new_releases' },
  { label: 'Loop Engine',     href: '/admin/loop-engine',  icon: 'all_inclusive' },
  { label: 'Organisations', href: '/admin/organizations', icon: 'groups', activePatterns: ['/admin/organizations', '/admin/org'] },
  { label: 'Onboarding', href: '/admin/onboarding', icon: 'how_to_reg' },
  { label: 'Demo Orgs', href: '/admin/demo-orgs', icon: 'science' },
  {
    label: 'Billing', href: '/admin/billing/revenue', icon: 'payments',
    children: [
      { label: 'Revenue', href: '/admin/billing/revenue' },
      { label: 'EFT queue', href: '/admin/billing/eft-queue' },
      { label: 'Coupons', href: '/admin/billing/coupons' },
      { label: 'Trials', href: '/admin/billing/trials' },
      { label: 'Dunning', href: '/admin/billing/dunning' },
      { label: 'Churn', href: '/admin/billing/churn' },
      { label: 'Referrals', href: '/admin/billing/referrals' },
      { label: 'Payouts', href: '/admin/billing/stripe-connect' },
      { label: 'Plans', href: '/admin/plans' },
      { label: 'Partners', href: '/admin/partners' },
    ],
    activePatterns: ['/admin/billing', '/admin/plans', '/admin/partners'],
  },
  {
    label: 'Agents', href: '/admin/agents', icon: 'group_work',
    children: [
      { label: 'Agents board', href: '/admin/agents' },
      { label: 'Hermes control', href: '/admin/hermes' },
      { label: 'Hermes metrics', href: '/admin/hermes/metrics' },
    ],
    activePatterns: ['/admin/agents', '/admin/hermes'],
  },
  { label: 'Skill Lab', href: '/admin/skill-lab', icon: 'science' },
  {
    label: 'Content', href: '/admin/content/seo', icon: 'article',
    children: [
      { label: 'SEO articles', href: '/admin/content/seo' },
      { label: 'Analytics', href: '/admin/content/analytics' },
      { label: 'Sitemap', href: '/admin/content/sitemap' },
      { label: 'API docs', href: '/admin/content/api-docs' },
    ],
    activePatterns: ['/admin/content'],
  },
  { label: 'Knowledge', href: '/admin/knowledge', icon: 'menu_book' },
  { label: 'Support',  href: '/admin/support',  icon: 'support_agent' },
  {
    label: 'Settings', href: '/admin/settings', icon: 'settings',
    children: [
      { label: 'Settings',       href: '/admin/settings' },
      { label: 'Platform users', href: '/admin/platform-users' },
      { label: 'Platform members', href: '/admin/platform-members' },
      { label: 'API keys',       href: '/admin/settings/api-keys' },
      { label: '2FA', href: '/admin/2fa' },
    ],
    activePatterns: ['/admin/platform-users', '/admin/platform-members', '/admin/properties', '/admin/moderation', '/admin/domains', '/admin/analytics', '/admin/reports', '/admin/tools', '/admin/system/audit-log', '/admin/settings/social-credentials', '/admin/2fa'],
  },
]

// ── Workspace nav ───────────────────────────────────────────────────────────

export function workspaceNav(slug: string): NavItem[] {
  return [
    { label: 'Overview', href: `/admin/org/${slug}/dashboard`, icon: 'space_dashboard', group: 'work' },
    { label: 'Projects',  href: `/admin/org/${slug}/projects`,   icon: 'rocket_launch', group: 'work' },
    { label: 'Documents', href: `/admin/org/${slug}/documents`, icon: 'description', group: 'work' },
    { label: 'Research', href: `/admin/org/${slug}/research`, icon: 'travel_explore', group: 'work' },
    { label: 'Book Studio', href: `/admin/org/${slug}/book-studio`, icon: 'auto_stories', group: 'work', activePatterns: [`/admin/org/${slug}/book-studio`] },
    { label: 'Mobile Apps', href: `/admin/org/${slug}/mobile-apps`, icon: 'smartphone', group: 'work' },
    { label: 'YouTube Studio', href: `/admin/org/${slug}/youtube-studio`, icon: 'smart_display', group: 'work' },
    {
      label: 'Marketing',
      href: `/admin/org/${slug}/marketing`,
      icon: 'campaign',
      group: 'work',
      activePatterns: [
        `/admin/org/${slug}/brand`,
        `/admin/org/${slug}/social`,
        `/admin/org/${slug}/campaigns`,
        `/admin/org/${slug}/seo`,
        `/admin/org/${slug}/capture-sources`,
        `/admin/org/${slug}/integrations`,
        `/admin/org/${slug}/email-domains`,
      ],
    },
    { label: 'Messages', href: `/admin/org/${slug}/messages`, icon: 'forum', group: 'work' },
    {
      label: 'Reports',
      href: `/admin/org/${slug}/intelligence`,
      icon: 'analytics',
      group: 'data',
      activePatterns: [`/admin/org/${slug}/activity`, `/admin/org/${slug}/geo-seo`],
    },
    { label: 'Wiki', href: `/admin/org/${slug}/wiki`, icon: 'menu_book', group: 'data' },
    { label: 'Team',     href: `/admin/org/${slug}/team`,     icon: 'groups', group: 'comms' },
    { label: 'Billing',  href: `/admin/org/${slug}/billing`,  icon: 'payments', group: 'comms' },
    { label: 'Settings', href: `/admin/org/${slug}/settings`, icon: 'settings', group: 'comms' },
  ]
}
