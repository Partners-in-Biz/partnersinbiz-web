// app/(portal)/portal/settings/notifications/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { PushNotificationsToggle } from '@/components/pwa/PushNotificationsToggle'
import { NotificationPreferences } from '@/components/settings/NotificationPreferences'
import { PageHeader } from '@/components/ui/AppFoundation'
import { Icon, Panel, Status, Title } from '@/components/studio'

const readinessMetrics = [
  {
    label: 'CRM signals',
    value: '4',
    detail: 'Follow-ups, approvals, billing, and client messages.',
    icon: 'notifications_active',
  },
  {
    label: 'device channel',
    value: '1',
    detail: 'Browser push keeps critical work visible on this device.',
    icon: 'devices',
  },
  {
    label: 'Operating model',
    value: 'Team',
    detail: 'Team accountability starts with clear notification coverage.',
    icon: 'groups',
  },
]

const crmSignals = [
  {
    title: 'Follow-ups due',
    description: 'Sales owners need same-day nudges when a contact or deal needs action.',
    icon: 'event_upcoming',
  },
  {
    title: 'Approvals waiting',
    description: 'Managers should see campaign, content, and client-review work before it stalls.',
    icon: 'approval',
  },
  {
    title: 'Invoices and billing',
    description: 'Finance alerts keep accepted proposals and invoice events visible.',
    icon: 'receipt_long',
  },
  {
    title: 'Messages from clients',
    description: 'Client replies and portal messages should reach the people accountable for them.',
    icon: 'forum',
  },
]

function ReadinessMetric({
  label,
  value,
  detail,
  icon,
}: {
  label: string
  value: string
  detail: string
  icon: string
}) {
  return (
    <div className="pib-stat-card st-panel--flat min-w-0 space-y-3 p-4">
      <div className="relative flex items-start justify-between gap-2">
        <p className="sc-tiny">{label}</p>
        <Icon name={icon} />
      </div>
      <p className="st-num relative text-xl tabular-nums leading-none text-[var(--sc-ink)]">
        {value} {label}
      </p>
      <p className="sc-body relative text-[0.75rem] text-[var(--sc-ink-soft)]">{detail}</p>
    </div>
  )
}

function SignalCard({
  title,
  description,
  icon,
}: {
  title: string
  description: string
  icon: string
}) {
  return (
    <div className="pib-stat-card st-panel--flat min-w-0 space-y-3 p-4">
      <div className="relative flex items-start gap-4">
        <Icon name={icon} />
        <div className="min-w-0">
          <h3 className="text-sm text-[var(--sc-ink)]">{title}</h3>
          <p className="sc-body mt-2 text-[0.75rem] text-[var(--sc-ink-soft)]">{description}</p>
        </div>
      </div>
    </div>
  )
}

export default function NotificationsPage() {
  return (
    <div className="max-w-6xl space-y-8">
      <PageHeader
        title="Notifications."
        description="Keep CRM work visible across sales, approvals, billing, and client communication before the team grows."
      />

      <section role="region" aria-label="CRM notification command center" className="space-y-4">
        <div data-testid="notification-command-hero">
          <Panel className="!p-0 overflow-hidden">
            <div className="grid gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(320px,1.1fr)]">
              <div className="flex flex-col justify-between gap-8 border-b border-[var(--sc-line)] p-5 lg:border-b-0 lg:border-r">
                <div>
                  <Icon name="notifications_active" />
                  <p className="sc-tiny mt-4">Operating readiness</p>
                  <Title className="mt-3">Notification command center</Title>
                  <p className="sc-body mt-3 max-w-xl text-[var(--sc-ink-soft)]">
                    Device notifications are the first channel. Treat them as a CRM readiness check for the events that should not wait for someone to open the app.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Status>Team accountability</Status>
                  <Status>Browser push first</Status>
                </div>
              </div>

              <div data-testid="notification-readiness-grid" className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
                {readinessMetrics.map((metric) => (
                  <ReadinessMetric key={metric.label} {...metric} />
                ))}
              </div>
            </div>
          </Panel>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <section data-testid="notification-push-panel" className="pib-card-section">
          <div className="pib-card-section-header">
            <p className="sc-tiny">Device channel</p>
          </div>
          <div className="space-y-4 p-5">
            <div>
              <Title>Push notifications</Title>
              <p className="sc-body mt-2 text-[var(--sc-ink-soft)]">
                Enable browser push on this device so urgent CRM work reaches the person who owns it.
              </p>
            </div>
            <Panel flat className="p-4">
              <PushNotificationsToggle />
            </Panel>
          </div>
        </section>

        <section className="pib-card-section">
          <div className="pib-card-section-header">
            <p className="sc-tiny">CRM signals</p>
          </div>
          <div className="space-y-4 p-5">
            <div>
              <Title>Events that need attention</Title>
              <p className="sc-body mt-2 text-[var(--sc-ink-soft)]">
                These are the notification categories the command center keeps visible while the full preference model expands.
              </p>
            </div>
            <div data-testid="notification-signal-grid" className="grid gap-4 md:grid-cols-2">
              {crmSignals.map((signal) => (
                <SignalCard key={signal.title} {...signal} />
              ))}
            </div>
          </div>
        </section>
      </div>

      <NotificationPreferences />
    </div>
  )
}
