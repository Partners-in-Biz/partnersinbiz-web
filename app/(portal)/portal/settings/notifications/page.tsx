// app/(portal)/portal/settings/notifications/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { PushNotificationsToggle } from '@/components/pwa/PushNotificationsToggle'
import { NotificationPreferences } from '@/components/settings/NotificationPreferences'

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
    <div className="pib-stat-card min-w-0 space-y-3">
      <div className="relative flex items-start justify-between gap-3">
        <p className="eyebrow !text-[10px]">{label}</p>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]" aria-hidden="true">
          {icon}
        </span>
      </div>
      <p className="relative font-display text-3xl leading-none text-[var(--color-pib-text)]">
        {value} {label}
      </p>
      <p className="relative text-xs leading-5 text-[var(--color-pib-text-muted)]">{detail}</p>
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
    <div className="pib-stat-card min-w-0 space-y-3 p-4">
      <div className="relative flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] text-[var(--color-pib-text-muted)]">
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{icon}</span>
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">{title}</h3>
          <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">{description}</p>
        </div>
      </div>
    </div>
  )
}

export default function NotificationsPage() {
  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="eyebrow !text-[10px]">CRM operations</p>
          <h1 className="pib-page-title mt-2">Notifications</h1>
          <p className="pib-page-sub max-w-2xl">
            Keep CRM work visible across sales, approvals, billing, and client communication before the team grows.
          </p>
        </div>
      </div>

      <section role="region" aria-label="CRM notification command center" className="space-y-4">
        <div data-testid="notification-command-hero" className="bento-card !p-0 overflow-hidden">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(320px,1.1fr)]">
            <div className="flex flex-col justify-between gap-8 border-b border-[var(--color-pib-line)] p-6 lg:border-b-0 lg:border-r">
              <div>
                <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--color-pib-accent)]/25 bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]">
                  <span className="material-symbols-outlined text-[22px]" aria-hidden="true">notifications_active</span>
                </span>
                <p className="eyebrow !text-[10px]">Operating readiness</p>
                <h2 className="mt-3 text-2xl font-semibold tracking-normal text-[var(--color-pib-text)]">
                  Notification command center
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--color-pib-text-muted)]">
                  Device notifications are the first channel. Treat them as a CRM readiness check for the events that should not wait for someone to open the app.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full border border-[var(--color-pib-line)] px-3 py-1.5 text-xs text-[var(--color-pib-text-muted)]">
                  Team accountability
                </span>
                <span className="rounded-full border border-[var(--color-pib-line)] px-3 py-1.5 text-xs text-[var(--color-pib-text-muted)]">
                  Browser push first
                </span>
              </div>
            </div>

            <div data-testid="notification-readiness-grid" className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {readinessMetrics.map((metric) => (
                <ReadinessMetric key={metric.label} {...metric} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <section data-testid="notification-push-panel" className="pib-card-section">
          <div className="pib-card-section-header">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Device channel</p>
          </div>
          <div className="space-y-4 p-5">
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-pib-text)]">Push notifications</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                Enable browser push on this device so urgent CRM work reaches the person who owns it.
              </p>
            </div>
            <div className="pib-stat-card min-w-0 p-4">
              <PushNotificationsToggle />
            </div>
          </div>
        </section>

        <section className="pib-card-section">
          <div className="pib-card-section-header">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">CRM signals</p>
          </div>
          <div className="space-y-4 p-5">
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-pib-text)]">Events that need attention</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                These are the notification categories the command center keeps visible while the full preference model expands.
              </p>
            </div>
            <div data-testid="notification-signal-grid" className="grid gap-3 md:grid-cols-2">
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
