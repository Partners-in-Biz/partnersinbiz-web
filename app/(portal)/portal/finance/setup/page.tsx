import Link from 'next/link'

export const dynamic = 'force-dynamic'

const STEPS = [
  {
    title: '1. Bootstrap finance admin assignment',
    body: 'Owner/admin creates a finance_admin assignment for the planned legal entity id. This unlocks foundation.configure for that entity.',
  },
  {
    title: '2. Create legal entity + primary book',
    body: 'Use the Finance workbench bootstrap action or POST /api/v1/finance/foundation/commands with legal-entity.create and book.create.',
  },
  {
    title: '3. Chart of accounts and periods',
    body: 'Create ledger accounts and open accounting periods before posting. Periods must not overlap within a book.',
  },
  {
    title: '4. Approvals and journals',
    body: 'Journal post and reverse require separate approval evidence. Posted journals are immutable; reversals create opposite entries.',
  },
  {
    title: '5. Later slices',
    body: 'VAT returns, supplier bills, bank reconciliation, intercompany, and ZA payroll domain engines are implemented and tested. Durable HTTP + UI for those slices ships next without changing the ledger contract.',
  },
]

export default function FinanceSetupPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="pib-card p-6">
        <p className="eyebrow">Finance</p>
        <h1 className="pib-page-title mt-2">Finance setup guide</h1>
        <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">
          Safe internal bootstrap path for the Partners in Biz finance foundation. No automatic payments, no SARS submission, no production cutover from this guide.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/portal/finance" className="pib-btn-primary">Open workbench</Link>
          <Link href="/portal/invoicing" className="pib-btn-ghost">Operational invoicing</Link>
        </div>
      </header>
      <section className="space-y-3">
        {STEPS.map((step) => (
          <article key={step.title} className="pib-card p-5">
            <h2 className="text-base font-semibold">{step.title}</h2>
            <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{step.body}</p>
          </article>
        ))}
      </section>
    </div>
  )
}
