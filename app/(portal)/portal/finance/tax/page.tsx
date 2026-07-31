import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default function FinanceTaxPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="pib-card p-6">
        <p className="eyebrow">Finance</p>
        <h1 className="pib-page-title mt-2">Tax codes and returns</h1>
        <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">
          Durable tax configuration and return preparation over the foundation book scope.
          No SARS submission or external payment initiation is available from this surface.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/portal/finance" className="pib-btn-primary">Back to workbench</Link>
          <Link href="/portal/finance/reports" className="pib-btn-ghost">Ledger reports</Link>
        </div>
      </header>
      <section className="pib-card space-y-3 p-6 text-sm text-[var(--color-pib-text-muted)]">
        <p>Authenticated APIs:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>GET /api/v1/finance/tax/queries?resource=bundle&orgId=…&legalEntityId=…&bookId=…</li>
          <li>POST /api/v1/finance/tax/commands operations: tax-code.create, tax-rule.create, tax-period.create, tax-period.status, tax-return.prepare, tax-return.approve, tax.calculate</li>
        </ul>
        <p>
          Approvals for tax-rule.approve and tax.return.approve come from foundation approval.create. Returns lock without initiating SARS egress.
        </p>
      </section>
    </div>
  )
}
