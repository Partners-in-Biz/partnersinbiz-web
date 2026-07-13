import Link from 'next/link'
import { scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'

export const MARKETING_STUDIO_DESTINATIONS = [
  { label: 'Overview', href: '/portal/marketing' },
  { label: 'Campaigns', href: '/portal/campaigns' },
  { label: 'Journeys', href: '/portal/sequences' },
  { label: 'Automations', href: '/portal/settings/automations' },
  { label: 'Templates & brand', href: '/portal/email-templates' },
  { label: 'Audiences', href: '/portal/segments' },
  { label: 'Capture', href: '/portal/capture-sources' },
  { label: 'Inbox & replies', href: '/portal/email/inbound' },
  { label: 'Analytics', href: '/portal/email-analytics' },
  { label: 'Deliverability', href: '/portal/email-deliverability' },
  { label: 'Settings', href: '/portal/email-preferences' },
] as const

type MarketingStudioNavProps = {
  scope: PortalOrgRouteScope
  active?: (typeof MARKETING_STUDIO_DESTINATIONS)[number]['label']
}

export function MarketingStudioNav({ scope, active = 'Overview' }: MarketingStudioNavProps) {
  return (
    <nav aria-label="Marketing Studio" className="min-w-0 overflow-x-auto border-b border-[var(--color-card-border)] [scrollbar-width:none]">
      <div className="flex min-w-max items-center gap-1 px-2">
        {MARKETING_STUDIO_DESTINATIONS.map((item) => {
          const isActive = item.label === active
          return (
            <Link
              key={item.label}
              href={scopedPortalPath(item.href, scope)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex h-10 items-center whitespace-nowrap px-2.5 text-xs font-medium transition ${
                isActive
                  ? 'text-[var(--color-pib-text)] after:absolute after:inset-x-2 after:bottom-0 after:h-px after:bg-primary'
                  : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
