import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default function FinancePayrollPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="pib-card p-6">
        <p className="eyebrow">Finance</p>
        <h1 className="pib-page-title mt-2">South African payroll</h1>
        <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">
          Employees, pay components, versioned tax tables, locked pay runs, payslips, corrections,
          and IRP5/EMP201/EMP501-ready records. Salary payments are observed externally — never initiated.
          Direct SARS submission remains a later roadmap item.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/portal/finance" className="pib-btn-primary">Back to workbench</Link>
          <Link href="/portal/finance/documents" className="pib-btn-ghost">Documents</Link>
          <Link href="/portal/finance/tax" className="pib-btn-ghost">Tax</Link>
        </div>
      </header>
      <section className="pib-card space-y-3 p-6 text-sm text-[var(--color-pib-text-muted)]">
        <p>Authenticated APIs:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>GET /api/v1/finance/payroll/queries?resource=bundle|payslip|irp5|emp201|emp501|export-manifest&…</li>
          <li>
            POST /api/v1/finance/payroll/commands operations covering employees, rules, calendars,
            calculate, pay-run lifecycle, salary-payment.observe, tax-year, YTD openings,
            IRP5/EMP201/EMP501 prepare/approve, and internal export manifests
          </li>
        </ul>
        <p>
          Payslip and statutory reads use non-enumerating authorization. sarsSubmissionInitiated and
          externalPaymentInitiated remain false.
        </p>
      </section>
    </div>
  )
}
