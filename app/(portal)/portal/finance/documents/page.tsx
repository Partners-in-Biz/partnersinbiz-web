import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default function FinanceDocumentsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="pib-card p-6">
        <p className="eyebrow">Finance</p>
        <h1 className="pib-page-title mt-2">Invoices, bills, payments & reconciliation</h1>
        <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">
          Customer invoices, supplier bills, external payment observation/matching, bank accounts,
          and statement reconciliation on the foundation book scope. PiB records money movement —
          it does not initiate bank payments.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/portal/finance" className="pib-btn-primary">Back to workbench</Link>
          <Link href="/portal/finance/tax" className="pib-btn-ghost">Tax</Link>
          <Link href="/portal/invoicing" className="pib-btn-ghost">Operational invoicing</Link>
        </div>
      </header>
      <section className="pib-card space-y-3 p-6 text-sm text-[var(--color-pib-text-muted)]">
        <p>Authenticated APIs:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>GET /api/v1/finance/documents/queries?resource=bundle&orgId=…&legalEntityId=…&bookId=…</li>
          <li>
            POST /api/v1/finance/documents/commands operations: invoice.create/issue/void,
            supplier-bill.create/issue, payment.observe/verify/allocate/allocation.reverse,
            bank-account.create, bank-transaction.import,
            reconciliation.create/match/submit/approve
          </li>
        </ul>
        <p>
          Reconciliation approval requires foundation approval.create evidence with separation of duties.
          externalPaymentInitiated remains false on every path.
        </p>
      </section>
    </div>
  )
}
