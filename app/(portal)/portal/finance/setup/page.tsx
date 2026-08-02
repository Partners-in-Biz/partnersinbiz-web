'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { HudChip } from '@/components/ui/HudChip'
import { FinanceModuleFrame } from '@/components/finance/FinanceModuleFrame'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

const STEPS = [
  {
    title: '1. Bootstrap finance admin assignment',
    body: 'Owner/admin creates a finance_admin assignment for the planned legal entity id. This unlocks foundation.configure for that entity.',
  },
  {
    title: '2. Create legal entity + primary book',
    body: 'Use the Finance command centre bootstrap action or POST /api/v1/finance/foundation/commands with legal-entity.create and book.create.',
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
    title: '5. Operating lanes',
    body: 'Use Documents for AR/AP, Tax for VAT returns, Payroll for ZA runs, and Packaging for download-only SARS/accountant packs. No SARS submit and no external payment initiate from these screens.',
  },
]

export default function FinanceSetupPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])

  return (
    <FinanceModuleFrame
      active="setup"
      orgScope={orgScope}
      title="Finance setup guide"
      description="Safe internal bootstrap path for the Partners in Biz finance foundation. No automatic payments, no SARS submission, no production cutover from this guide."
      meta={
        <div className="flex flex-wrap items-center gap-1.5">
          <HudChip tone="accent">Bootstrap only</HudChip>
          <HudChip>No SARS submit</HudChip>
          <HudChip>No external payout</HudChip>
        </div>
      }
      actions={
        <div className="flex flex-wrap gap-1.5">
          <Link href={scopedPortalPath('/portal/finance', orgScope)} className="pib-btn-primary btn-pib-sm">
            Open command centre
          </Link>
          <Link href={scopedPortalPath('/portal/invoicing', orgScope)} className="pib-btn-ghost btn-pib-sm">
            Operational invoicing
          </Link>
        </div>
      }
    >
      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold">Recommended sequence</h2>
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          Keep tenant scope on every finance URL via org query params. Commands send X-Org-Id and exact legal entity/book scope.
        </p>
      </Card>
      <section className="space-y-3">
        {STEPS.map((step) => (
          <Card key={step.title} className="p-5">
            <h2 className="text-base font-semibold">{step.title}</h2>
            <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{step.body}</p>
          </Card>
        ))}
      </section>
      <div className="flex flex-wrap gap-2">
        <Link href={scopedPortalPath('/portal/finance', orgScope)}>
          <Button variant="primary">Go to command centre</Button>
        </Link>
        <Link href={scopedPortalPath('/portal/finance/ledger', orgScope)}>
          <Button variant="ghost">Open ledger</Button>
        </Link>
      </div>
    </FinanceModuleFrame>
  )
}
