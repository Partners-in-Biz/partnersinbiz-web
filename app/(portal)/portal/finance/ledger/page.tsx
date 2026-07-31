import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default function FinanceLedgerPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="pib-card p-6">
        <p className="eyebrow">Finance</p>
        <h1 className="pib-page-title mt-2">Ledger detail</h1>
        <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">
          Posted journals are append-only. Use the foundation workbench to inspect recent entries, periods, and the chart of accounts for the selected entity/book scope.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/portal/finance" className="pib-btn-primary">Back to workbench</Link>
          <Link href="/portal/finance/setup" className="pib-btn-ghost">Setup guide</Link>
        </div>
      </header>
      <section className="pib-card space-y-3 p-6 text-sm text-[var(--color-pib-text-muted)]">
        <p>
          API surface:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>GET /api/v1/finance/foundation/queries?resource=journals&orgId=…&legalEntityId=…&bookId=…</li>
          <li>POST /api/v1/finance/foundation/commands operation journal.post</li>
          <li>POST /api/v1/finance/foundation/commands operation journal.reverse</li>
        </ul>
        <p>
          Reversals never mutate the original posted entry. They create a balanced opposite entry with reversesJournalEntryId linkage and full audit/outbox evidence.
        </p>
      </section>
    </div>
  )
}
