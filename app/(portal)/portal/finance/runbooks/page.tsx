'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { HudChip } from '@/components/ui/HudChip'
import { StatCard } from '@/components/ui/StatCard'
import { FinanceModuleFrame } from '@/components/finance/FinanceModuleFrame'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

type Runbook = {
  id: string
  title: string
  summary: string
  href: string
  cta: string
  emptyState?: string
  gates?: string[]
}

const DAY0: Runbook[] = [
  {
    id: 'A',
    title: 'A · Day-0 bootstrap',
    summary: 'finance_admin → legal entity + book → chart of accounts → open period. Do not start with journals.',
    href: '/portal/finance/setup',
    cta: 'Open setup guide',
    emptyState: 'Empty hub entity/book pickers mean bootstrap has not run yet.',
  },
  {
    id: 'B',
    title: 'B · Opening TB / cutover',
    summary: 'Balanced opening trial balance + AR/AP open-item recon → approve → activate (sets book.cutoverAt).',
    href: '/portal/finance/cutover',
    cta: 'Cutover wizard',
    emptyState: 'No cutover packages until you create a balanced opening set.',
    gates: ['No SARS submit', 'No payment initiate'],
  },
]

const DAY2: Runbook[] = [
  {
    id: 'C',
    title: 'C · AR / AP golden path',
    summary: 'Invoice → partial payment allocate → credit note → statement totals. Bulk issue/void/allocate and aging live here.',
    href: '/portal/finance/documents',
    cta: 'Open AR/AP',
    emptyState: 'No documents yet is normal after COA — create the first invoice or bill.',
    gates: ['massEmailAllowed=false', 'No payment initiate'],
  },
  {
    id: 'D',
    title: 'D · Bank import + rules',
    summary: 'Import statement, apply bank rules, Accept/Dismiss suggestions only. Rules never auto-post and never pay out.',
    href: '/portal/finance/statements',
    cta: 'Statements',
    emptyState: 'Empty suggestion queues mean no unmatched lines or no rules evaluated yet.',
    gates: ['Human accept only', 'Never auto-post'],
  },
  {
    id: 'E',
    title: 'E · Tax prepare',
    summary: 'VAT codes, periods, prepare and approve return packages for download — never e-file to SARS from PiB.',
    href: '/portal/finance/tax',
    cta: 'Tax workbench',
    gates: ['No SARS submit'],
  },
  {
    id: 'F',
    title: 'F · ZA payroll day-2',
    summary: 'Calendar, leave, calculate → review → lock. Payslip pack download only. ESS sees own payslips. Corrections via auditable paths.',
    href: '/portal/finance/payroll',
    cta: 'Payroll',
    gates: ['No bank payout', 'No mass email', 'No SARS submit'],
  },
  {
    id: 'G',
    title: 'G · Multi-currency',
    summary: 'Approve rate sets, foreign documents with functional amounts, realized FX on settlement, balanced period revaluation.',
    href: '/portal/finance/multi-currency',
    cta: 'Multi-currency',
  },
  {
    id: 'H',
    title: 'H · Job costing',
    summary: 'projectId on lines, optional time → WIP/draft invoice, project P&L without double-billing.',
    href: '/portal/finance/job-costing',
    cta: 'Job costing',
  },
  {
    id: 'I',
    title: 'I · Fixed assets',
    summary: 'Register, straight-line depreciation runs, disposal gain/loss, stop future depreciation.',
    href: '/portal/finance/assets',
    cta: 'Assets',
  },
  {
    id: 'J',
    title: 'J · Budgets / cashflow',
    summary: 'Budget versions, budget vs actual, cashflow planner lite. Planning only — no GL post from the planner.',
    href: '/portal/finance/budgets',
    cta: 'Budgets',
    gates: ['Planning only'],
  },
  {
    id: 'K',
    title: 'K · Practice, roles, audit',
    summary: 'Least-privilege roles, multi-client switcher (membership only), notifications, audit explorer filters.',
    href: '/portal/finance/practice',
    cta: 'Practice',
  },
  {
    id: 'L',
    title: 'L · Packaging downloads',
    summary: 'SARS-ready, payment instruction, and accountant packs. Download/manifest only with externalEgressAllowed=false.',
    href: '/portal/finance/packaging',
    cta: 'Packaging',
    gates: ['No SARS submit', 'No payment initiate', 'egress=false'],
  },
  {
    id: 'P',
    title: 'P · Phase 5 proving kit',
    summary:
      'Seed deterministic multi-entity demo company, run multi-period close fixture (blockers → freeze), packaging dry-run, and printable accountant acceptance checklist with evidence checkboxes.',
    href: '/portal/finance/proving',
    cta: 'Open proving kit',
    emptyState: 'No seed until finance_admin runs Seed demo company (idempotent by seedKey).',
    gates: ['No SARS submit', 'No payment initiate', 'egress=false', 'Throw-away fixture'],
  },
]

const DIFFERENTIATORS: Runbook[] = [
  {
    id: 'M',
    title: 'M · Intercompany + cross-org',
    summary: 'IC propose/confirm/eliminations and cross-org payment notify/confirm. Observe and confirm — never initiate external money movement.',
    href: '/portal/finance/intercompany',
    cta: 'Intercompany',
    gates: ['No payment initiate'],
  },
  {
    id: 'N',
    title: 'N · Agent / Kanban evidence',
    summary: 'Fetch project context first. Prefer finance HTTP commands. Record commit SHAs, verify commands, and hard-gate confirmation in agentOutput.',
    href: '/portal/finance',
    cta: 'Command centre',
  },
  {
    id: 'O',
    title: 'O · Phase 5 proving kit',
    summary: 'Seed multi-entity demo company, run multi-period close fixture, packaging dry-run, and printable accountant acceptance checklist with evidence checkboxes.',
    href: '/portal/finance/proving',
    cta: 'Proving kit',
    emptyState: 'Empty seed snapshot means the demo company has not been seeded for this org yet.',
    gates: ['No SARS submit', 'No payment initiate', 'Idempotent seed'],
  },
]

function RunbookSection({
  heading,
  items,
  orgScope,
}: {
  heading: string
  items: Runbook[]
  orgScope: ReturnType<typeof scopeFromSearchParams>
}) {
  return (
    <section className="space-y-3" data-testid="finance-runbook-section">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-pib-text-muted)]">{heading}</h3>
      {items.map((item) => (
        <Card key={item.id} className="p-5" data-testid="finance-runbook-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-[var(--color-pib-text)]">{item.title}</h2>
              <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{item.summary}</p>
              {item.emptyState ? (
                <p className="mt-2 rounded-lg border border-dashed border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted,transparent)] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  Empty state: {item.emptyState}
                </p>
              ) : null}
              {item.gates && item.gates.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.gates.map((gate) => (
                    <HudChip key={gate}>{gate}</HudChip>
                  ))}
                </div>
              ) : null}
            </div>
            <Link href={scopedPortalPath(item.href, orgScope)} className="shrink-0">
              <Button variant="ghost" size="sm">
                {item.cta}
              </Button>
            </Link>
          </div>
        </Card>
      ))}
    </section>
  )
}

export default function FinanceRunbooksPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])

  return (
    <FinanceModuleFrame
      active="runbooks"
      orgScope={orgScope}
      title="Finance operator runbooks"
      description="Phase 4 day-0 and day-2 operator paths for books, AR/AP, bank, payroll, packaging, and practice. Development/staging first. No SARS submit, no external payment initiate, no mass payslip/statement email."
      meta={
        <div className="flex flex-wrap items-center gap-1.5">
          <HudChip tone="accent">Operator runbooks</HudChip>
          <HudChip>No SARS submit</HudChip>
          <HudChip>No external payout</HudChip>
          <HudChip>Human-gated recon</HudChip>
        </div>
      }
      actions={
        <div className="flex flex-wrap gap-1.5">
          <Link href={scopedPortalPath('/portal/finance/setup', orgScope)} className="pib-btn-primary btn-pib-sm">
            Setup guide
          </Link>
          <Link href={scopedPortalPath('/portal/finance/proving', orgScope)} className="pib-btn-ghost btn-pib-sm">
            Proving kit
          </Link>
          <Link href={scopedPortalPath('/portal/finance', orgScope)} className="pib-btn-ghost btn-pib-sm">
            Command centre
          </Link>
          <Link href={scopedPortalPath('/portal/finance/packaging', orgScope)} className="pib-btn-ghost btn-pib-sm">
            Packaging
          </Link>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="finance-runbook-stats">
        <StatCard label="Day-0 paths" value={String(DAY0.length)} detail="Bootstrap + cutover" icon="flag" />
        <StatCard label="Day-2 lanes" value={String(DAY2.length)} detail="Ops workbenches" icon="route" />
        <StatCard label="Differentiators" value={String(DIFFERENTIATORS.length)} detail="IC, cross-org, agents" icon="hub" />
        <StatCard label="Hard gates" value="4" detail="SARS / pay / email / auto-post" icon="shield" />
      </div>

      <Card className="space-y-3 p-5" data-testid="finance-runbook-intro">
        <h2 className="text-base font-semibold">How to use</h2>
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          Follow setup first if the tenant is empty, then cutover, then day-2 lanes. Keep tenant scope on every finance URL.
          Commands send X-Org-Id with exact legal entity and book scope. For Quinn staging acceptance, use the Phase 4 acceptance pack
          in the repo under docs/operations/finance/ — this page is the operator map, not a permanent CEO dashboard.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <HudChip>Tenant scoped</HudChip>
          <HudChip>ModuleShell parity</HudChip>
          <HudChip>Spec Flie3SblIDXvplYmqOhy</HudChip>
          <HudChip>Project HRCSWl1cNnh6fYEGziAb</HudChip>
        </div>
      </Card>

      <RunbookSection heading="Day-0 foundation" items={DAY0} orgScope={orgScope} />
      <RunbookSection heading="Day-2 operating lanes" items={DAY2} orgScope={orgScope} />
      <RunbookSection heading="Differentiators and agent ops" items={DIFFERENTIATORS} orgScope={orgScope} />

      <Card className="space-y-3 p-5" data-testid="finance-runbook-hard-gates">
        <h2 className="text-base font-semibold">Hard gates (always on)</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-pib-text-muted)]">
          <li>No SARS e-filing submit from Tax, Payroll, or Packaging.</li>
          <li>No external bank payment initiation from Documents, Statements, Bank rules, Payroll, or Packaging.</li>
          <li>Bank rule and recon suggestion accept never auto-posts journals.</li>
          <li>Budgets and cashflow plans are planning-only.</li>
          <li>Mass email of payslips or customer statements stays separately gated.</li>
          <li>Production promote and main merge remain a separate Peet gate after Quinn acceptance.</li>
        </ul>
      </Card>

      <Card className="space-y-3 p-5" data-testid="finance-runbook-acceptance">
        <h2 className="text-base font-semibold">Acceptance pack pointer</h2>
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          Quinn runs automated verifies (verify:finance:security, test:finance:unit, portal-design-system-parity, workbench-delivery,
          module verifies) plus golden-path smoke on staging. Durable checklist:
          docs/operations/finance/phase4-acceptance-pack-2026-08-02.md. Durable narrative runbooks:
          docs/operations/finance/operator-runbooks-phase4-2026-08-02.md.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href={scopedPortalPath('/portal/finance/proving', orgScope)}>
            <Button variant="primary">Accountant acceptance checklist</Button>
          </Link>
          <Link href={scopedPortalPath('/portal/finance/setup', orgScope)}>
            <Button variant="ghost">Guided setup</Button>
          </Link>
          <Link href={scopedPortalPath('/portal/finance/practice', orgScope)}>
            <Button variant="ghost">Practice / audit</Button>
          </Link>
          <Link href={scopedPortalPath('/portal/finance/cross-org', orgScope)}>
            <Button variant="ghost">Cross-org confirm</Button>
          </Link>
        </div>
      </Card>
    </FinanceModuleFrame>
  )
}
