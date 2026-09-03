import Link from 'next/link'
import { PageHeader } from '@/components/ui/AppFoundation'
import { StatCard } from '@/components/ui/StatCard'
import { ButtonLink, Icon, Title } from '@/components/studio'

export const dynamic = 'force-dynamic'

const BILLING_SECTIONS = [
  {
    title: 'Finance workbench',
    href: '/portal/finance',
    icon: 'account_balance',
    body: 'Legal entities, books, periods, chart of accounts, and double-entry journal foundation.',
  },
  {
    title: 'Invoices',
    href: '/portal/invoicing',
    icon: 'receipt_long',
    body: 'Create, edit, send, and track EFT-adapted invoices and quotes.',
  },
  {
    title: 'Payments',
    href: '/portal/payments',
    icon: 'payments',
    body: 'Review received invoices, quote decisions, and payment pressure for the active workspace.',
  },
  {
    title: 'Recurring billing',
    href: '/portal/invoicing/recurring',
    icon: 'event_repeat',
    body: 'Manage repeating invoice schedules and next-due billing cadence.',
  },
  {
    title: 'New invoice',
    href: '/portal/invoicing/new',
    icon: 'add_card',
    body: 'Start a draft invoice with line items, tax, notes, and client details.',
  },
]

const BILLING_METRICS = [
  { label: 'Payment rail', value: 'EFT', helper: 'Proof upload and admin verification replace card checkout.' },
  { label: 'Invoice states', value: '7', helper: 'Includes payment pending verification and overdue.' },
  { label: 'Quote flow', value: 'Live', helper: 'Sent, accepted, declined, expired, and converted states.' },
  { label: 'Public invoices', value: 'Tokenized', helper: 'Public invoice links support proof upload.' },
]

export default function PortalBillingPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <PageHeader
        eyebrow="Billing"
        title="Billing hub."
        description="One place for EFT invoices, payment review, recurring schedules, quotes, and public invoice handoffs."
        actions={(
          <>
            <ButtonLink href="/portal/finance" size="sm">Open finance</ButtonLink>
            <ButtonLink href="/portal/invoicing" variant="ghost" size="sm">Open invoices</ButtonLink>
            <ButtonLink href="/portal/payments" variant="ghost" size="sm">Open payments</ButtonLink>
          </>
        )}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {BILLING_METRICS.map((metric) => (
          <StatCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            detail={metric.helper}
          />
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {BILLING_SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="st-panel block transition-colors hover:border-[var(--sc-ink)]"
          >
            <div className="flex items-start gap-4">
              <Icon name={section.icon} className="shrink-0 text-[var(--sc-ink-soft)]" />
              <div>
                <Title as="h2">{section.title}</Title>
                <p className="sc-body mt-2 text-[var(--sc-ink-soft)]">{section.body}</p>
              </div>
            </div>
          </Link>
        ))}
      </section>
    </div>
  )
}
