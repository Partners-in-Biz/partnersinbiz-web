import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default function FinanceIntercompanyPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="pib-card p-6">
        <p className="eyebrow">Finance</p>
        <h1 className="pib-page-title mt-2">Intercompany & consolidation</h1>
        <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">
          Optional multi-entity pairs, mirrored due-to/due-from transactions with receive approval,
          elimination rules, and consolidation runs. Single-entity organisations can ignore this surface.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/portal/finance" className="pib-btn-primary">Back to workbench</Link>
          <Link href="/portal/finance/documents" className="pib-btn-ghost">Documents</Link>
          <Link href="/portal/finance/reports" className="pib-btn-ghost">Reports</Link>
        </div>
      </header>
      <section className="pib-card space-y-3 p-6 text-sm text-[var(--color-pib-text-muted)]">
        <p>Authenticated APIs:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>GET /api/v1/finance/intercompany/queries?resource=bundle&orgId=…&legalEntityId=…&bookId=…</li>
          <li>
            POST /api/v1/finance/intercompany/commands operations: pair.create/activate,
            transaction.propose/post-source/approve-receive/post-receiving/reject,
            elimination-rule.create/approve, consolidation.create/pin/post-eliminations/approve
          </li>
        </ul>
        <p>Entity books stay independently balanced; eliminations post only to consolidation books.</p>
      </section>
    </div>
  )
}
