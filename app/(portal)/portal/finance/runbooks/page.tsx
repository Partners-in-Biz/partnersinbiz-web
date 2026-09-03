'use client'

import Link from 'next/link'

import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { HudChip } from '@/components/ui/HudChip'
import { StatCard } from '@/components/ui/StatCard'
import { FinanceModuleFrame } from '@/components/finance/FinanceModuleFrame'
import { scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import { usePortalOrgScope } from '@/lib/portal/usePortalOrgScope'

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
    emptyState: 'No documents yet is normal after COA - create the first invoice or bill.',
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
    summary: 'VAT codes, periods, prepare and approve return packages for download - never e-file to SARS from PiB.',
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
    title: 'H · Job costing closed loop',
    summary:
      'Quote/project → time cost → WIP aging → draft invoice → cash on Documents. Load closed loop on /portal/finance/job-costing. Guards: no double-bill, no double-cost, no payout/SARS.',
    href: '/portal/finance/job-costing',
    cta: 'Job costing',
    gates: ['No double-bill', 'No double-cost', 'No payment initiate'],
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
    summary: 'Budget versions, budget vs actual, cashflow planner lite. Planning only - no GL post from the planner.',
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
]

const PHASE5_CLOSE: Runbook[] = [
  {
    id: 'P5-A',
    title: 'P5-A · Monthly close (by role)',
    summary:
      'Owner approvals, bookkeeper capture/bank, accountant period-close blockers → TB freeze, practice multi-client handoff. Use the period-close command centre before hard close.',
    href: '/portal/finance/period-close',
    cta: 'Period-close centre',
    emptyState: 'Load sources first; blockers appear after evaluate against open period activity.',
    gates: ['SOD approvals', 'No SARS submit', 'No payment initiate'],
  },
  {
    id: 'P5-B',
    title: 'P5-B · Bank feed sync + human recon',
    summary:
      'Mock-first connector: configure → sync staged lines → Accept/Dismiss suggestions only → finish zero-difference recon on statements. Never auto-post, never pay out.',
    href: '/portal/finance/bank-feeds',
    cta: 'Bank feeds',
    emptyState: 'No connection until finance_admin configures the mock (or later vendor) feed for a bank account.',
    gates: ['Human accept only', 'Never auto-post', 'noEgress'],
  },
  {
    id: 'P5-C',
    title: 'P5-C · Multi-entity consolidation',
    summary:
      'Close each entity book, confirm IC pairs, post eliminations only on the consolidation book, review consolidated TB, package multi-entity manifest.',
    href: '/portal/finance/intercompany',
    cta: 'Intercompany',
    gates: ['Elims on consol only', 'No payment initiate'],
  },
  {
    id: 'P5-D',
    title: 'P5-D · Payroll bureau month-end',
    summary:
      'Multi-entity batch board, leave calendar, SOD lock, bulk payslip ZIP download, EMP201/EMP501 + IRP5 batch prepare/export only.',
    href: '/portal/finance/payroll',
    cta: 'Payroll bureau',
    gates: ['No bank payout', 'No mass email', 'No SARS submit'],
  },
  {
    id: 'P5-E',
    title: 'P5-E · Accountant external review pack',
    summary:
      'Walk TB, journals, open items, bank recon, payroll statutory prepares, IC summary, and audit CSV. Download-only packaging with externalEgressAllowed=false.',
    href: '/portal/finance/packaging',
    cta: 'Packaging',
    gates: ['Download only', 'No SARS submit', 'egress=false'],
  },
  {
    id: 'P5-F',
    title: 'P5-F · Incident / rollback (bad imports)',
    summary:
      'Reverse-not-delete for posted journals; duplicate fingerprints on re-import; dismiss bad feed suggestions; correction runs for locked payroll. Full notes in repo Phase 5 close runbooks.',
    href: '/portal/finance/statements',
    cta: 'Statements / recon',
    gates: ['Immutable posted journals', 'Audited reversals'],
  },
  {
    id: 'P5-P',
    title: 'P5-P · Proving kit + checklist',
    summary:
      'Seed deterministic multi-entity demo, multi-period close fixture (blockers → hard_closed + frozen TB), packaging dry-run, printable accountant acceptance checklist.',
    href: '/portal/finance/proving',
    cta: 'Open proving kit',
    emptyState: 'No seed until finance_admin runs Seed demo company (idempotent by seedKey).',
    gates: ['No SARS submit', 'No payment initiate', 'Throw-away fixture'],
  },
  {
    id: 'P6-M',
    title: 'P6-M · Multi-month close program',
    summary:
      'Beyond single fixtures: seed → multi-month close (OPS+SVC × May–July) with IC/FX/payroll lock/bank recon history → packaging dry-run → export accountant acceptance pack (sign-off artifact). Evidence under artifacts/finance/multi-month-close/.',
    href: '/portal/finance/proving',
    cta: 'Multi-month proving',
    emptyState: 'Run Seed then Multi-month close program on /portal/finance/proving, or npm run verify:finance:proving.',
    gates: ['≥3 periods', '≥2 entities', 'No SARS submit', 'No payment initiate'],
  },
]

const PHASE6_WORLD: Runbook[] = [
  {
    id: 'P6-A',
    title: 'P6-A · Multi-month close program',
    summary:
      'Market proof: ≥3 closed periods across ≥2 entities with IC, payroll lock, bank recon history, packaging, and frozen TB continuity. Prefer proving kit or internal demo org - not live client tenants without Peet OK.',
    href: '/portal/finance/proving',
    cta: 'Proving / program',
    emptyState: 'Seed demo company first (idempotent seedKey), then multi-period close fixture or manual M1→M3 loop.',
    gates: ['≥3 periods', '≥2 entities', 'No SARS submit', 'No payment initiate'],
  },
  {
    id: 'P6-B',
    title: 'P6-B · Bank feed daily recon product',
    summary:
      'Morning path: connection health, multi-account sync, recon centre aging, safe bulk accept/dismiss (confidence ≥0.8, never flag_review), then zero-diff statement recon. File import remains fallback. Never auto-post; paid vendor is a separate Peet gate.',
    href: '/portal/finance/bank-feeds',
    cta: 'Bank feeds',
    emptyState: 'No connection until finance_admin configures mock (default) feed for a bank account.',
    gates: ['Human accept only', 'Never auto-post', 'Mock default', 'noEgress'],
  },
  {
    id: 'P6-C',
    title: 'P6-C · Claims, rev-rec, grants, ESS, cash, jobs',
    summary:
      'Expense claims (OCR confirm-only, post to books/payable, no payout), revenue recognition lite period runs, practice firm→client grants, employee ESS payslips/leave downloads, cash forecast scenarios (planning-only), job-cost closed loop on /portal/finance/job-costing (quote→time→WIP aging→invoice→cash; draft invoice releases WIP).',
    href: '/portal/finance/job-costing',
    cta: 'Job costing hub',
    gates: ['No payout from claims', 'OCR never auto-apply', 'Cash planning-only', 'ESS least privilege', 'No double-bill'],
  },
  {
    id: 'P6-C6',
    title: 'P6-C6 · Job costing closed loop only',
    summary:
      'Operator path: set project (+ optional quote) → apply WIP time cost → Load closed loop (trace + P&L + aging) → draft invoice lines for billable time (releases WIP) → issue/allocate cash on Documents → re-load loop. Regression: same TE cannot double-apply per purpose.',
    href: '/portal/finance/job-costing',
    cta: 'Open closed loop',
    emptyState: 'Empty applications until time cost is applied for the selected book/project.',
    gates: ['No double-bill', 'No double-cost', 'No payment initiate', 'No SARS submit'],
  },
  {
    id: 'P6-D',
    title: 'P6-D · External accountant sign-off pack',
    summary:
      'One-sitting walkthrough: multi-month TB, period-close blockers, bank recon, payroll statutory prepare, packaging download-only. Checklist artifact (typed name OK) - not wet-signature product. externalEgressAllowed=false.',
    href: '/portal/finance/packaging',
    cta: 'Packaging',
    gates: ['Download only', 'No SARS submit', 'egress=false'],
  },
  {
    id: 'P6-E',
    title: 'P6-E · Scale + keyboard / a11y density',
    summary:
      'Large ledger and statement import batching under load; bookkeeper keyboard paths and focus-visible controls when shipped. Reverse-not-delete still applies under stress.',
    href: '/portal/finance/documents',
    cta: 'Documents / bulk',
    gates: ['Batch caps', 'Audited reversals'],
  },
]

const DIFFERENTIATORS: Runbook[] = [
  {
    id: 'M',
    title: 'M · Intercompany + cross-org',
    summary: 'IC propose/confirm/eliminations and cross-org payment notify/confirm. Observe and confirm - never initiate external money movement.',
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
]

function RunbookSection({
  heading,
  items,
  orgScope,
}: {
  heading: string
  items: Runbook[]
  orgScope: PortalOrgRouteScope
}) {
  return (
    <section className="space-y-3" data-testid="finance-runbook-section">
      <h3 className="text-sm uppercase tracking-wide text-[var(--color-pib-text-muted)]">{heading}</h3>
      {items.map((item) => (
        <Card key={item.id} className="p-5" data-testid="finance-runbook-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-base text-[var(--color-pib-text)]">{item.title}</h2>
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
  const orgScope = usePortalOrgScope()

  return (
    <FinanceModuleFrame
      active="runbooks"
      orgScope={orgScope}
      title="Finance operator runbooks"
      description="Phase 4 day-0/day-2 paths, Phase 5 world-class close, and Phase 6 market-proof depth: multi-month close program, bank-feed daily recon product, expense claims/rev-rec/grants/ESS/cash/job-cost, and external accountant sign-off. Development/staging first. No SARS submit, no external payment initiate, no mass payslip/statement email, no paid bank-feed vendor without Peet gate."
      meta={
        <div className="flex flex-wrap items-center gap-1.5">
          <HudChip tone="accent">Operator runbooks</HudChip>
          <HudChip>Phase 6 market proof</HudChip>
          <HudChip>Phase 5 close</HudChip>
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
          <Link href={scopedPortalPath('/portal/finance/period-close', orgScope)} className="pib-btn-ghost btn-pib-sm">
            Period close
          </Link>
          <Link href={scopedPortalPath('/portal/finance/proving', orgScope)} className="pib-btn-ghost btn-pib-sm">
            Proving kit
          </Link>
          <Link href={scopedPortalPath('/portal/finance/bank-feeds', orgScope)} className="pib-btn-ghost btn-pib-sm">
            Bank feeds
          </Link>
          <Link href={scopedPortalPath('/portal/finance', orgScope)} className="pib-btn-ghost btn-pib-sm">
            Command centre
          </Link>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" data-testid="finance-runbook-stats">
        <StatCard label="Day-0 paths" value={String(DAY0.length)} detail="Bootstrap + cutover" icon="flag" />
        <StatCard label="Day-2 lanes" value={String(DAY2.length)} detail="Ops workbenches" icon="route" />
        <StatCard label="Phase 5 close" value={String(PHASE5_CLOSE.length)} detail="Month-end world-class" icon="lock_clock" />
        <StatCard label="Phase 6 depth" value={String(PHASE6_WORLD.length)} detail="Market proof + daily ops" icon="verified" />
        <StatCard label="Differentiators" value={String(DIFFERENTIATORS.length)} detail="IC, agents" icon="hub" />
        <StatCard label="Hard gates" value="5" detail="SARS / pay / email / auto-post / vendor" icon="shield" />
      </div>

      <Card className="space-y-3 p-5" data-testid="finance-runbook-intro">
        <h2 className="text-base">How to use</h2>
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          Follow setup first if the tenant is empty, then cutover, then day-2 lanes. For single-period month-end, use Phase 5 close
          lanes and the period-close command centre. For market-proof multi-month close, bank-feed daily product path, expense
          claims/rev-rec/grants/ESS/cash/job-cost, and external accountant sign-off, use Phase 6 lanes. Keep tenant scope on every
          finance URL. Commands send X-Org-Id with exact legal entity and book scope. For Quinn staging acceptance, use the Phase 6
          acceptance pack under docs/operations/finance/ (Phase 5 pack remains the close baseline) - this page is the operator map,
          not a permanent CEO dashboard.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <HudChip>Tenant scoped</HudChip>
          <HudChip>ModuleShell parity</HudChip>
          <HudChip>Spec Flie3SblIDXvplYmqOhy</HudChip>
          <HudChip>Project HRCSWl1cNnh6fYEGziAb</HudChip>
          <HudChip>Task upcYUjl6v1R44SC7kd3Z</HudChip>
        </div>
      </Card>

      <RunbookSection heading="Day-0 foundation" items={DAY0} orgScope={orgScope} />
      <RunbookSection heading="Day-2 operating lanes" items={DAY2} orgScope={orgScope} />
      <RunbookSection heading="Phase 5 world-class close" items={PHASE5_CLOSE} orgScope={orgScope} />
      <RunbookSection heading="Phase 6 market proof + product depth" items={PHASE6_WORLD} orgScope={orgScope} />
      <RunbookSection heading="Differentiators and agent ops" items={DIFFERENTIATORS} orgScope={orgScope} />

      <Card className="space-y-3 p-5" data-testid="finance-runbook-hard-gates">
        <h2 className="text-base">Hard gates (always on)</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-pib-text-muted)]">
          <li>No SARS e-filing submit from Tax, Payroll, Packaging, Proving, or ESS.</li>
          <li>No external bank payment initiation from Documents, Expense claims, Statements, Bank feeds, Bank rules, Payroll, or Packaging.</li>
          <li>Bank feed, bank rule, OCR assist, and recon suggestion accept never auto-posts journals.</li>
          <li>Budgets, cashflow plans, and cash scenarios are planning-only.</li>
          <li>Mass email of payslips or customer statements stays separately gated.</li>
          <li>Paid bank-feed / open-banking vendor contracts require a separate Peet commercial gate (mock default).</li>
          <li>Production promote and main merge remain a separate Peet gate after Quinn acceptance.</li>
        </ul>
      </Card>

      <Card className="space-y-3 p-5" data-testid="finance-runbook-acceptance">
        <h2 className="text-base">Acceptance pack pointer</h2>
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          Quinn runs automated verifies (verify:finance:security, test:finance:unit, portal-design-system-parity, workbench-delivery,
          proving, operator-depth, bank-feeds, payroll, job-costing, plus foundation modules and Phase 6 module scripts when present)
          and golden-path smoke on staging. Durable Phase 6 checklist:
          docs/operations/finance/phase6-acceptance-pack-2026-08-03.md. Durable Phase 6 narrative runbooks:
          docs/operations/finance/operator-runbooks-phase6-world-class-2026-08-03.md. Phase 5 close baseline remains under the
          2026-08-03 phase5 filenames; Phase 4 under 2026-08-02.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href={scopedPortalPath('/portal/finance/proving', orgScope)}>
            <Button variant="primary">Accountant acceptance checklist</Button>
          </Link>
          <Link href={scopedPortalPath('/portal/finance/period-close', orgScope)}>
            <Button variant="ghost">Period-close centre</Button>
          </Link>
          <Link href={scopedPortalPath('/portal/finance/setup', orgScope)}>
            <Button variant="ghost">Guided setup</Button>
          </Link>
          <Link href={scopedPortalPath('/portal/finance/practice', orgScope)}>
            <Button variant="ghost">Practice / audit</Button>
          </Link>
          <Link href={scopedPortalPath('/portal/finance/bank-feeds', orgScope)}>
            <Button variant="ghost">Bank feeds</Button>
          </Link>
        </div>
      </Card>
    </FinanceModuleFrame>
  )
}
