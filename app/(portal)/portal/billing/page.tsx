import Link from 'next/link'

export const dynamic = 'force-dynamic'

const BILLING_SECTIONS = [
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
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="pib-card p-6">
        <p className="eyebrow">Billing</p>
        <h1 className="pib-page-title mt-2">Billing hub</h1>
        <p className="mt-3 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
          One place for EFT invoices, payment review, recurring schedules, quotes, and public invoice handoffs.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/portal/invoicing" className="pib-btn-primary">Open invoices</Link>
          <Link href="/portal/payments" className="pib-btn-ghost">Open payments</Link>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {BILLING_METRICS.map((metric) => (
          <div key={metric.label} className="pib-card p-5">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{metric.label}</p>
            <p className="mt-3 text-2xl font-semibold text-on-surface">{metric.value}</p>
            <p className="mt-2 text-xs text-on-surface-variant">{metric.helper}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {BILLING_SECTIONS.map((section) => (
          <Link key={section.href} href={section.href} className="pib-card group p-5 transition hover:border-[var(--color-pib-accent)]/60">
            <div className="flex items-start gap-4">
              <span className="material-symbols-outlined text-[28px] text-[var(--color-pib-accent)]">{section.icon}</span>
              <div>
                <h2 className="text-lg font-semibold text-on-surface group-hover:text-[var(--color-pib-accent)]">{section.title}</h2>
                <p className="mt-2 text-sm text-on-surface-variant">{section.body}</p>
              </div>
            </div>
          </Link>
        ))}
      </section>
    </div>
  )
}
