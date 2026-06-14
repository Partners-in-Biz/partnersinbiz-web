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
  { label: 'Home',         href: '/admin/dashboard',    icon: 'space_dashboard', group: 'work' },
  { label: 'Updates',      href: '/admin/updates',      icon: 'new_releases', group: 'work' },
  { label: 'Loop Engine',  href: '/admin/loop-engine',  icon: 'all_inclusive', group: 'work' },
  { label: 'Organisations', href: '/admin/organizations', icon: 'groups', group: 'work', activePatterns: ['/admin/organizations'] },
  { label: 'Agents',   href: '/admin/agents',   icon: 'group_work', group: 'work' },
  { label: 'Skill Lab', href: '/admin/skill-lab', icon: 'science', group: 'data' },
  { label: 'Knowledge', href: '/admin/knowledge', icon: 'menu_book', group: 'data' },
  { label: 'Support',   href: '/admin/support',   icon: 'support_agent', group: 'comms' },
  { label: 'Settings', href: '/admin/settings', icon: 'settings', group: 'comms', activePatterns: ['/admin/platform-users', '/admin/platform-members'] },
]

export const OPERATOR_NAV_TOPBAR: NavItem[] = [
  { label: 'Home',     href: '/admin/dashboard',    icon: 'space_dashboard' },
  { label: 'Updates',  href: '/admin/updates',      icon: 'new_releases' },
  { label: 'Loop Engine', href: '/admin/loop-engine', icon: 'all_inclusive' },
  { label: 'Organisations', href: '/admin/organizations', icon: 'groups', activePatterns: ['/admin/organizations'] },
  { label: 'Agents',   href: '/admin/agents',   icon: 'group_work' },
  { label: 'Skill Lab', href: '/admin/skill-lab', icon: 'science' },
  { label: 'Knowledge', href: '/admin/knowledge', icon: 'menu_book' },
  { label: 'Support',  href: '/admin/support',  icon: 'support_agent' },
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
