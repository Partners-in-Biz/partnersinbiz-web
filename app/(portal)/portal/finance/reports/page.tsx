import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default function FinanceReportsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="pib-card p-6">
        <p className="eyebrow">Finance</p>
        <h1 className="pib-page-title mt-2">Financial reports</h1>
        <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">
          Ledger-backed trial balance, income statement, and balance sheet read from posted journal lines.
          Operational billing reports remain under the existing Reports/Analytics modules.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/portal/finance" className="pib-btn-primary">Back to workbench</Link>
        </div>
      </header>
      <section className="pib-card space-y-3 p-6 text-sm text-[var(--color-pib-text-muted)]">
        <p>Authenticated query API:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>GET /api/v1/finance/reports/queries?resource=trial-balance&orgId=…&legalEntityId=…&bookId=…&asOfDate=YYYY-MM-DD&accountingBasis=accrual</li>
          <li>GET /api/v1/finance/reports/queries?resource=income-statement&…&fromDate=…&toDate=…</li>
          <li>GET /api/v1/finance/reports/queries?resource=balance-sheet&…&asOfDate=…</li>
        </ul>
        <p>
          Reports authorize with finance report.read and exact org/entity/book scope. No external egress.
        </p>
      </section>
    </div>
  )
}
