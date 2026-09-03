import { Icon } from '@/components/studio'
import Link from 'next/link'
import { scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'

type Program = {
  label: string
  description: string
  href: string
  icon: string
  cue: string
}

const PROGRAMS: Program[] = [
  {
    label: 'Campaigns',
    description: 'Email campaigns and the wider campaign workspace.',
    href: '/portal/campaigns',
    icon: 'campaign',
    cue: 'Plan',
  },
  {
    label: 'Broadcasts',
    description: 'One-off email and SMS sends, drafts and schedules.',
    href: '/portal/broadcasts',
    icon: 'outgoing_mail',
    cue: 'Send',
  },
  {
    label: 'Journeys',
    description: 'Multi-step nurture sequences and enrolment paths.',
    href: '/portal/sequences',
    icon: 'route',
    cue: 'Nurture',
  },
  {
    label: 'Automations',
    description: 'Rules triggered by CRM, form and sequence activity.',
    href: '/portal/settings/automations',
    icon: 'bolt',
    cue: 'Trigger',
  },
]

export function ProgramList({ scope }: { scope: PortalOrgRouteScope }) {
  return (
    <div className="divide-y divide-[var(--color-card-border)]">
      {PROGRAMS.map((program) => (
        <Link
          key={program.label}
          href={scopedPortalPath(program.href, scope)}
          className="group grid min-w-0 grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5 transition hover:bg-white/[0.025]"
        >
          <Icon name={program.icon} className="grid h-7 w-7 place-items-center rounded-md text-[16px]" />
          <span className="min-w-0">
            <span className="block text-xs text-[var(--color-pib-text)]">{program.label}</span>
            <span className="block truncate text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{program.description}</span>
          </span>
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
            {program.cue}
            <Icon name="chevron_right" />
          </span>
        </Link>
      ))}
    </div>
  )
}
