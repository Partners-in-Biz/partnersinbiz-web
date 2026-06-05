// app/(portal)/portal/settings/notifications/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { PushNotificationsToggle } from '@/components/pwa/PushNotificationsToggle'

const readinessMetrics = [
  {
    label: 'CRM signals',
    value: '4',
    detail: 'Follow-ups, approvals, billing, and client messages.',
  },
  {
    label: 'device channel',
    value: '1',
    detail: 'Browser push keeps critical work visible on this device.',
  },
  {
    label: 'Operating model',
    value: 'Team',
    detail: 'Team accountability starts with clear notification coverage.',
  },
]

const crmSignals = [
  {
    title: 'Follow-ups due',
    description: 'Sales owners need same-day nudges when a contact or deal needs action.',
  },
  {
    title: 'Approvals waiting',
    description: 'Managers should see campaign, content, and client-review work before it stalls.',
  },
  {
    title: 'Invoices and billing',
    description: 'Finance alerts keep accepted proposals and invoice events visible.',
  },
  {
    title: 'Messages from clients',
    description: 'Client replies and portal messages should reach the people accountable for them.',
  },
]

export default function NotificationsPage() {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">CRM settings</p>
          <h1 className="pib-page-title mt-2">Notifications</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
            Keep CRM work visible across sales, approvals, billing, and client communication before the team grows.
          </p>
        </div>
      </div>

      <section role="region" aria-label="CRM notification command center" className="space-y-4">
        <div className="pib-card space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="eyebrow !text-[10px]">Operating readiness</p>
              <h2 className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">Notification command center</h2>
              <p className="mt-2 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
                Device notifications are the first channel. Treat them as a CRM readiness check for the events that should not wait for someone to open the app.
              </p>
            </div>
            <div className="rounded-lg border border-[var(--color-pib-border)] bg-[var(--color-pib-surface-soft)] px-4 py-3 text-sm text-[var(--color-pib-text-muted)]">
              Team accountability
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {readinessMetrics.map((metric) => (
              <div key={metric.label} className="rounded-lg border border-[var(--color-pib-border)] bg-[var(--color-pib-surface-soft)] p-4">
                <p className="text-2xl font-semibold text-[var(--color-pib-text)]">
                  {metric.value} {metric.label}
                </p>
                <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">{metric.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="pib-card space-y-4">
          <div>
            <p className="eyebrow !text-[10px]">Device channel</p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">Push notifications</h2>
            <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
              Enable browser push on this device so urgent CRM work reaches the person who owns it.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-pib-border)] bg-[var(--color-pib-surface-soft)] p-4">
            <PushNotificationsToggle />
          </div>
        </div>

        <div className="pib-card space-y-4">
          <div>
            <p className="eyebrow !text-[10px]">CRM signals</p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">Events that need attention</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {crmSignals.map((signal) => (
              <div key={signal.title} className="rounded-lg border border-[var(--color-pib-border)] bg-[var(--color-pib-surface-soft)] p-4">
                <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">{signal.title}</h3>
                <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">{signal.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
