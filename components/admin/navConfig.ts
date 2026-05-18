export interface SubLink {
  label: string
  href: string
}

export interface NavItem {
  label: string
  href: string
  icon: string
  children?: SubLink[]
  activePatterns?: string[]
}

// ── Operator nav ────────────────────────────────────────────────────────────

export const OPERATOR_NAV: NavItem[] = [
  { label: 'Home',         href: '/admin/dashboard',    icon: 'space_dashboard' },
  { label: 'Clients',      href: '/admin/clients',      icon: 'groups', activePatterns: ['/admin/organizations'] },
  { label: 'Pipeline',     href: '/admin/crm/contacts', icon: 'view_kanban', activePatterns: ['/admin/crm'] },
  {
    label: 'Marketing',
    href: '/admin/marketing',
    icon: 'campaign',
    activePatterns: ['/admin/social', '/admin/campaigns', '/admin/broadcasts', '/admin/email', '/admin/sequences', '/admin/seo', '/admin/capture-sources'],
  },
  {
    label: 'Intelligence',
    href: '/admin/intelligence',
    icon: 'analytics',
    activePatterns: ['/admin/analytics', '/admin/properties', '/admin/reports', '/admin/email-analytics'],
  },
  {
    label: 'Finance',
    href: '/admin/finance',
    icon: 'receipt_long',
    activePatterns: ['/admin/invoicing', '/admin/quotes'],
  },
  { label: 'Documents', href: '/admin/documents', icon: 'description' },
  { label: 'Knowledge', href: '/admin/knowledge', icon: 'menu_book' },
  { label: 'Support',   href: '/admin/support',   icon: 'support_agent' },
  { label: 'Agents',   href: '/admin/agents',   icon: 'group_work' },
  { label: 'Settings', href: '/admin/settings', icon: 'settings', activePatterns: ['/admin/platform-users', '/admin/platform-members'] },
]

export const OPERATOR_NAV_TOPBAR: NavItem[] = [
  { label: 'Home',     href: '/admin/dashboard',    icon: 'space_dashboard' },
  { label: 'Clients',  href: '/admin/clients',      icon: 'groups', activePatterns: ['/admin/organizations'] },
  { label: 'Pipeline', href: '/admin/crm/contacts', icon: 'view_kanban', activePatterns: ['/admin/crm'] },
  {
    label: 'Marketing', href: '/admin/marketing', icon: 'campaign',
    children: [
      { label: 'Marketing hub', href: '/admin/marketing' },
      { label: 'Social',        href: '/admin/social' },
      { label: 'Campaigns',     href: '/admin/campaigns' },
      { label: 'Email',         href: '/admin/email' },
      { label: 'Sequences',     href: '/admin/sequences' },
      { label: 'SEO',           href: '/admin/seo' },
    ],
    activePatterns: ['/admin/social', '/admin/campaigns', '/admin/broadcasts', '/admin/email', '/admin/sequences', '/admin/seo', '/admin/capture-sources'],
  },
  {
    label: 'Intelligence', href: '/admin/intelligence', icon: 'analytics',
    children: [
      { label: 'Intelligence hub', href: '/admin/intelligence' },
      { label: 'Analytics',        href: '/admin/analytics' },
      { label: 'Properties',       href: '/admin/properties' },
      { label: 'Reports',          href: '/admin/reports' },
      { label: 'Email analytics',  href: '/admin/email-analytics' },
    ],
    activePatterns: ['/admin/analytics', '/admin/properties', '/admin/reports', '/admin/email-analytics'],
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
    { label: 'Overview', href: `/admin/org/${slug}/dashboard`, icon: 'space_dashboard' },
    { label: 'Projects',  href: `/admin/org/${slug}/projects`,   icon: 'rocket_launch' },
    { label: 'Documents', href: `/admin/org/${slug}/documents`, icon: 'description' },
    { label: 'Wiki', href: `/admin/org/${slug}/wiki`, icon: 'menu_book' },
    {
      label: 'Marketing',
      href: `/admin/org/${slug}/marketing`,
      icon: 'campaign',
      activePatterns: [
        `/admin/org/${slug}/brand`,
        `/admin/org/${slug}/social`,
        `/admin/org/${slug}/campaigns`,
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
    { label: 'Messages', href: `/admin/org/${slug}/messages`, icon: 'forum' },
    {
      label: 'Reports',
      href: `/admin/org/${slug}/intelligence`,
      icon: 'analytics',
      activePatterns: [`/admin/org/${slug}/activity`, '/admin/analytics', '/admin/properties', '/admin/reports'],
    },
    { label: 'Team',     href: `/admin/org/${slug}/team`,     icon: 'groups' },
    { label: 'Billing',  href: `/admin/org/${slug}/billing`,  icon: 'payments', activePatterns: ['/admin/invoicing', '/admin/quotes'] },
    { label: 'Settings', href: `/admin/org/${slug}/settings`, icon: 'settings' },
  ]
}
