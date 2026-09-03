'use client'

import Link from 'next/link'

import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { HudChip } from '@/components/ui/HudChip'
import { FinanceModuleFrame } from '@/components/finance/FinanceModuleFrame'
import { scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import { usePortalOrgScope } from '@/lib/portal/usePortalOrgScope'

type Step = {
  title: string
  body: string
  href?: string
  cta?: string
  emptyState?: string
}

const FOUNDATION_STEPS: Step[] = [
  {
    title: '1. Bootstrap finance admin assignment',
    body: 'Owner/admin creates a finance_admin assignment for the planned legal entity id. This unlocks foundation.configure for that entity.',
    href: '/portal/finance/practice',
    cta: 'Open practice roles',
    emptyState: 'If Practice shows no assignments, you are not yet a finance admin for any entity - start there before ledger writes.',
  },
  {
    title: '2. Create legal entity + primary book',
    body: 'Use the Finance command centre bootstrap action or foundation commands: legal-entity.create and book.create.',
    href: '/portal/finance',
    cta: 'Open command centre',
    emptyState: 'Empty hub entity/book pickers mean bootstrap has not run yet - do not jump to journals first.',
  },
  {
    title: '3. Chart of accounts and periods',
    body: 'Create ledger accounts and open accounting periods before posting. Periods must not overlap within a book.',
    href: '/portal/finance/ledger',
    cta: 'Open ledger',
    emptyState: 'Empty chart/periods lists are expected on a new book - create COA and at least one open period.',
  },
  {
    title: '4. Approvals and journals',
    body: 'Journal post and reverse require separate approval evidence. Posted journals are immutable; reversals create opposite entries.',
    href: '/portal/finance/ledger',
    cta: 'Post via ledger',
  },
]

const OPERATING_STEPS: Step[] = [
  {
    title: '5. AR / AP depth',
    body: 'Customer invoices, supplier bills, credit/debit notes, recurring schedules, bulk issue/void/allocate, aging, and draft counterparty statements.',
    href: '/portal/finance/documents',
    cta: 'Open AR/AP',
    emptyState: 'No documents yet is normal - create a customer invoice or supplier bill after COA exists.',
  },
  {
    title: '6. Bank statements + bank rules',
    body: 'Import statements, generate recon suggestions, then add bank rules for smarter matches. Accept/dismiss is always human-gated - never auto-posts and never initiates payouts.',
    href: '/portal/finance/statements',
    cta: 'Statements',
    emptyState: 'Empty suggestion queues mean no unmatched bank lines or no rules evaluated yet.',
  },
  {
    title: '7. Bank rules workbench',
    body: 'Create description/amount match rules that only emit suggestions for operator review.',
    href: '/portal/finance/bank-rules',
    cta: 'Bank rules',
  },
  {
    title: '8. Tax, payroll, assets, job costing',
    body: 'Configure VAT codes/periods, ZA payroll calendar/leave/payslips, fixed assets depreciation, and project job costing dimensions.',
    href: '/portal/finance/tax',
    cta: 'Tax first',
    emptyState: 'Each lane shows empty operator tables until the first configure/create command succeeds.',
  },
  {
    title: '9. Multi-currency, budgets, practice',
    body: 'Approve immutable FX rate sets before foreign docs; plan cash with budgets/forecasts; use Practice for multi-client switcher, notifications, and audit explorer.',
    href: '/portal/finance/budgets',
    cta: 'Budgets & cashflow',
  },
  {
    title: '10. Cutover + packaging',
    body: 'Opening trial balance cutover requires balanced TB + AR/AP open-item recon + approval. Packaging is download/manifest only (SARS-ready, payment instructions, accountant packs) - no submit, no bank initiate.',
    href: '/portal/finance/cutover',
    cta: 'Cutover wizard',
    emptyState: 'No cutover packages until you create one from a balanced opening set.',
  },
]

function StepList({ steps, orgScope }: { steps: Step[]; orgScope: PortalOrgRouteScope }) {
  return (
    <section className="space-y-3">
      {steps.map((step) => (
        <Card key={step.title} className="p-5" data-testid="finance-onboarding-step">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-base text-[var(--color-pib-text)]">{step.title}</h2>
              <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{step.body}</p>
              {step.emptyState ? (
                <p className="mt-2 rounded-lg border border-dashed border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted,transparent)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  Empty state: {step.emptyState}
                </p>
              ) : null}
            </div>
            {step.href ? (
              <Link href={scopedPortalPath(step.href, orgScope)} className="shrink-0">
                <Button variant="ghost" size="sm">{step.cta || 'Open'}</Button>
              </Link>
            ) : null}
          </div>
        </Card>
      ))}
    </section>
  )
}

export default function FinanceSetupPage() {
  const orgScope = usePortalOrgScope()

  return (
    <FinanceModuleFrame
      active="setup"
      orgScope={orgScope}
      title="Finance guided onboarding"
      description="Operator path from empty tenant to day-2 finance ops inside the PiB portal. No automatic payments, no SARS submission, no production cutover from this guide."
      meta={
        <div className="flex flex-wrap items-center gap-1.5">
          <HudChip tone="accent">Guided setup</HudChip>
          <HudChip>No SARS submit</HudChip>
          <HudChip>No external payout</HudChip>
          <HudChip>Empty-state aware</HudChip>
        </div>
      }
      actions={
        <div className="flex flex-wrap gap-1.5">
          <Link href={scopedPortalPath('/portal/finance', orgScope)} className="pib-btn-primary btn-pib-sm">
            Command centre
          </Link>
          <Link href={scopedPortalPath('/portal/finance/runbooks', orgScope)} className="pib-btn-ghost btn-pib-sm">
            Operator runbooks
          </Link>
          <Link href={scopedPortalPath('/portal/finance/cutover', orgScope)} className="pib-btn-ghost btn-pib-sm">
            Cutover
          </Link>
          <Link href={scopedPortalPath('/portal/finance/bank-rules', orgScope)} className="pib-btn-ghost btn-pib-sm">
            Bank rules
          </Link>
        </div>
      }
    >
      <Card className="space-y-3 p-5" data-testid="finance-onboarding-intro">
        <h2 className="text-base">How to use this guide</h2>
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          Work top to bottom. Keep tenant scope on every finance URL via org query params. Commands send X-Org-Id and exact legal entity/book scope.
          Empty tables are intentional until the prerequisite step is done - each step calls out what “empty” means so operators are not blocked by blank screens.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <HudChip>Foundation first</HudChip>
          <HudChip>Then operating lanes</HudChip>
          <HudChip>Cutover last</HudChip>
        </div>
      </Card>

      <div className="space-y-2">
        <h3 className="text-sm uppercase tracking-wide text-[var(--color-pib-text-muted)]">Foundation</h3>
        <StepList steps={FOUNDATION_STEPS} orgScope={orgScope} />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm uppercase tracking-wide text-[var(--color-pib-text-muted)]">Day-2 operating lanes</h3>
        <StepList steps={OPERATING_STEPS} orgScope={orgScope} />
      </div>

      <Card className="space-y-3 p-5" data-testid="finance-onboarding-hard-gates">
        <h2 className="text-base">Hard gates (always on)</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-pib-text-muted)]">
          <li>No SARS e-filing submit from Tax, Payroll, or Packaging.</li>
          <li>No external bank payment initiation from Documents, Statements, Bank rules, Payroll, or Packaging.</li>
          <li>Bank rule / recon suggestion accept never auto-posts journals.</li>
          <li>Budgets and cashflow plans are planning-only.</li>
          <li>Mass email of payslips or customer statements stays separately gated.</li>
        </ul>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Link href={scopedPortalPath('/portal/finance', orgScope)}>
          <Button variant="primary">Go to command centre</Button>
        </Link>
        <Link href={scopedPortalPath('/portal/finance/setup', orgScope)}>
          <Button variant="ghost">Refresh guide</Button>
        </Link>
      </div>
    </FinanceModuleFrame>
  )
}
