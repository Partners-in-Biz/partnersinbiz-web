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

// ── Operator nav ────────────────────────────────────────────────────────────

export const OPERATOR_NAV: NavItem[] = [
  { label: 'Home',         href: '/admin/dashboard',    icon: 'space_dashboard', group: 'work' },
  { label: 'Updates',      href: '/admin/updates',      icon: 'new_releases', group: 'work' },
  { label: 'Loop Engine',  href: '/admin/loop-engine',  icon: 'all_inclusive', group: 'work' },
  { label: 'Briefings',    href: '/admin/briefings',    icon: 'team_dashboard', group: 'work' },
  { label: 'Clients',      href: '/admin/clients',      icon: 'groups', group: 'work', activePatterns: ['/admin/organizations'] },
  { label: 'Pipeline',     href: '/admin/crm/contacts', icon: 'view_kanban', group: 'work', activePatterns: ['/admin/crm'] },
  {
    label: 'Marketing',
    href: '/admin/marketing',
    icon: 'campaign',
    group: 'data',
    activePatterns: ['/admin/communications', '/admin/social', '/admin/campaigns', '/admin/broadcasts', '/admin/email', '/admin/sequences', '/admin/seo', '/admin/capture-sources'],
  },
  {
    label: 'Intelligence',
    href: '/admin/intelligence',
    icon: 'analytics',
    group: 'data',
    activePatterns: ['/admin/analytics', '/admin/properties', '/admin/reports', '/admin/research', '/admin/email-analytics'],
  },
  {
    label: 'Finance',
    href: '/admin/finance',
    icon: 'receipt_long',
    group: 'comms',
    activePatterns: ['/admin/invoicing', '/admin/quotes'],
  },
  { label: 'Documents', href: '/admin/documents', icon: 'description', group: 'work' },
  { label: 'Research', href: '/admin/research', icon: 'travel_explore', group: 'data' },
  { label: 'Knowledge', href: '/admin/knowledge', icon: 'menu_book', group: 'data' },
  { label: 'Support',   href: '/admin/support',   icon: 'support_agent', group: 'comms' },
  { label: 'Agents',   href: '/admin/agents',   icon: 'group_work', group: 'comms' },
  { label: 'Skill Lab', href: '/admin/skill-lab', icon: 'science', group: 'comms' },
  { label: 'Settings', href: '/admin/settings', icon: 'settings', group: 'comms', activePatterns: ['/admin/platform-users', '/admin/platform-members'] },
]

export const OPERATOR_NAV_TOPBAR: NavItem[] = [
  { label: 'Home',     href: '/admin/dashboard',    icon: 'space_dashboard' },
  { label: 'Updates',  href: '/admin/updates',      icon: 'new_releases' },
  { label: 'Loop Engine', href: '/admin/loop-engine', icon: 'all_inclusive' },
  { label: 'Briefings', href: '/admin/briefings', icon: 'team_dashboard' },
  { label: 'Clients',  href: '/admin/clients',      icon: 'groups', activePatterns: ['/admin/organizations'] },
  { label: 'Pipeline', href: '/admin/crm/contacts', icon: 'view_kanban', activePatterns: ['/admin/crm'] },
  {
    label: 'Marketing', href: '/admin/marketing', icon: 'campaign',
    children: [
      { label: 'Marketing hub', href: '/admin/marketing' },
      { label: 'Communications', href: '/admin/communications' },
      { label: 'Social',        href: '/admin/social' },
      { label: 'Campaigns',     href: '/admin/campaigns' },
      { label: 'Email',         href: '/admin/email' },
      { label: 'Internal mailbox', href: '/admin/email/mailbox' },
      { label: 'Sequences',     href: '/admin/sequences' },
      { label: 'SEO',           href: '/admin/seo' },
    ],
    activePatterns: ['/admin/communications', '/admin/social', '/admin/campaigns', '/admin/broadcasts', '/admin/email', '/admin/sequences', '/admin/seo', '/admin/capture-sources'],
  },
  {
    label: 'Intelligence', href: '/admin/intelligence', icon: 'analytics',
    children: [
      { label: 'Intelligence hub', href: '/admin/intelligence' },
      { label: 'Analytics',        href: '/admin/analytics' },
      { label: 'Properties',       href: '/admin/properties' },
      { label: 'Reports',          href: '/admin/reports' },
      { label: 'Research',         href: '/admin/research' },
      { label: 'Email analytics',  href: '/admin/email-analytics' },
    ],
    activePatterns: ['/admin/analytics', '/admin/properties', '/admin/reports', '/admin/research', '/admin/email-analytics'],
  },
  {
    label: 'Finance', href: '/admin/finance', icon: 'receipt_long',
    children: [
      { label: 'Finance hub', href: '/admin/finance' },
      { label: 'Invoices',    href: '/admin/invoicing' },
      { label: 'Recurring',   href: '/admin/invoicing/recurring' },
      { label: 'Quotes',      href: '/admin/quotes' },
    ],
    activePatterns: ['/admin/invoicing', '/admin/quotes'],
  },
  { label: 'Knowledge', href: '/admin/knowledge', icon: 'menu_book' },
  { label: 'Support',  href: '/admin/support',  icon: 'support_agent' },
  { label: 'Agents',   href: '/admin/agents',   icon: 'group_work' },
  { label: 'Skill Lab', href: '/admin/skill-lab', icon: 'science' },
  {
    label: 'Settings', href: '/admin/settings', icon: 'settings',
    children: [
      { label: 'Settings',       href: '/admin/settings' },
      { label: 'Platform users', href: '/admin/platform-users' },
      { label: 'Platform members', href: '/admin/platform-members' },
      { label: 'API keys',       href: '/admin/settings/api-keys' },
    ],
    activePatterns: ['/admin/platform-users', '/admin/platform-members'],
  },
]

// ── Workspace nav ───────────────────────────────────────────────────────────

export function workspaceNav(slug: string): NavItem[] {
  return [
    { label: 'Overview', href: `/admin/org/${slug}/dashboard`, icon: 'space_dashboard', group: 'work' },
    { label: 'Projects',  href: `/admin/org/${slug}/projects`,   icon: 'rocket_launch', group: 'work' },
    { label: 'Documents', href: `/admin/org/${slug}/documents`, icon: 'description', group: 'work' },
    { label: 'Research', href: `/admin/org/${slug}/research`, icon: 'travel_explore', group: 'work' },
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
        '/admin/communications',
        `/admin/org/${slug}/seo`,
        `/admin/org/${slug}/capture-sources`,
        `/admin/org/${slug}/integrations`,
        `/admin/org/${slug}/email-domains`,
        '/admin/social',
        '/admin/email',
        '/admin/sequences',
        '/admin/seo',
      ],
    },
    { label: 'Messages', href: `/admin/org/${slug}/messages`, icon: 'forum', group: 'work' },
    {
      label: 'Reports',
      href: `/admin/org/${slug}/intelligence`,
      icon: 'analytics',
      group: 'data',
      activePatterns: [`/admin/org/${slug}/activity`, '/admin/analytics', '/admin/properties', '/admin/reports'],
    },
    { label: 'Wiki', href: `/admin/org/${slug}/wiki`, icon: 'menu_book', group: 'data' },
    { label: 'Team',     href: `/admin/org/${slug}/team`,     icon: 'groups', group: 'comms' },
    { label: 'Billing',  href: `/admin/org/${slug}/billing`,  icon: 'payments', group: 'comms', activePatterns: ['/admin/invoicing', '/admin/quotes'] },
    { label: 'Settings', href: `/admin/org/${slug}/settings`, icon: 'settings', group: 'comms' },
  ]
}
