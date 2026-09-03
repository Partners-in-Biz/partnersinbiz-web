'use client'

import Link from 'next/link'
import { Icon } from '@/components/studio'
import { useCallback, useEffect, useState } from 'react'
import { FinanceModuleFrame, FinanceEmptyScope } from '@/components/finance/FinanceModuleFrame'
import { FinanceScopeBar } from '@/components/finance/FinanceScopeBar'
import { useFinanceBookScope } from '@/components/finance/useFinanceBookScope'
import { formatMinor, readFinanceJson, todayISODate } from '@/components/finance/financeWorkbench'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { HudChip } from '@/components/ui/HudChip'
import type { PeriodCloseCommandCentre } from '@/lib/accounting/operator-depth-types'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'

type SnapshotSources = {
  reconciliations: Array<{ id: string; status?: string }>
  journals: Array<{ id: string; status?: string; approvalStatus?: string }>
  payRuns: Array<{ id: string; status?: string }>
  fxRevaluationRuns: Array<{ id: string; status?: string; periodId?: string }>
  cutoverPackages: Array<{ id: string; status?: string }>
  periods: Array<{ id: string; status?: string; fiscalYear?: number; periodNumber?: number }>
}

export default function FinancePeriodClosePage() {
  const scope = useFinanceBookScope()
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [centre, setCentre] = useState<PeriodCloseCommandCentre | null>(null)
  const [sources, setSources] = useState<SnapshotSources | null>(null)
  const [requireFxReval, setRequireFxReval] = useState(false)
  const [requireCutoverComplete, setRequireCutoverComplete] = useState(false)
  const [asOfDate, setAsOfDate] = useState(todayISODate())

  const loadSources = useCallback(async () => {
    if (!scope.scopeReady) {
      setSources(null)
      setCentre(null)
      return
    }
    setLoading(true)
    scope.setError(null)
    try {
      const [docsRes, foundationRes, payrollRes, fxRes, cutoverRes] = await Promise.all([
        fetch(scope.queryUrl('/api/v1/finance/documents/queries', 'bundle'), { credentials: 'include' }),
        fetch(scope.queryUrl('/api/v1/finance/foundation/queries', 'bundle'), { credentials: 'include' }).catch(() => null),
        fetch(scope.queryUrl('/api/v1/finance/payroll/queries', 'bundle'), { credentials: 'include' }).catch(() => null),
        fetch(scope.queryUrl('/api/v1/finance/multi-currency/queries', 'bundle'), { credentials: 'include' }).catch(() => null),
        fetch(scope.queryUrl('/api/v1/finance/cutover/queries', 'bundle'), { credentials: 'include' }).catch(() => null),
      ])

      const docsBody = await readFinanceJson(docsRes)
      const docs = (docsBody?.data?.result ?? {}) as Record<string, any>

      let journals: SnapshotSources['journals'] = []
      let periods: SnapshotSources['periods'] = []
      if (foundationRes && foundationRes.ok) {
        const body = await readFinanceJson(foundationRes)
        const result = body?.data?.result ?? body?.data ?? {}
        journals = (result.journals || result.journalEntries || []) as SnapshotSources['journals']
        periods = (result.periods || []) as SnapshotSources['periods']
      } else {
        // fallback: periods query
        const periodsRes = await fetch(scope.queryUrl('/api/v1/finance/foundation/queries', 'periods'), { credentials: 'include' })
        if (periodsRes.ok) {
          const body = await readFinanceJson(periodsRes)
          periods = (body?.data?.result ?? []) as SnapshotSources['periods']
        }
        const journalsRes = await fetch(scope.queryUrl('/api/v1/finance/foundation/queries', 'journals'), { credentials: 'include' }).catch(() => null)
        if (journalsRes && journalsRes.ok) {
          const body = await readFinanceJson(journalsRes)
          journals = (body?.data?.result ?? []) as SnapshotSources['journals']
        }
      }

      let payRuns: SnapshotSources['payRuns'] = []
      if (payrollRes && payrollRes.ok) {
        const body = await readFinanceJson(payrollRes)
        payRuns = ((body?.data?.result?.payRuns) || []) as SnapshotSources['payRuns']
      }

      let fxRevaluationRuns: SnapshotSources['fxRevaluationRuns'] = []
      if (fxRes && fxRes.ok) {
        const body = await readFinanceJson(fxRes)
        fxRevaluationRuns = ((body?.data?.result?.revaluationRuns) || (body?.data?.result?.fxRevaluationRuns) || []) as SnapshotSources['fxRevaluationRuns']
      }

      let cutoverPackages: SnapshotSources['cutoverPackages'] = []
      if (cutoverRes && cutoverRes.ok) {
        const body = await readFinanceJson(cutoverRes)
        cutoverPackages = ((body?.data?.result?.packages) || (body?.data?.result?.cutoverPackages) || []) as SnapshotSources['cutoverPackages']
      }

      const next: SnapshotSources = {
        reconciliations: (docs.reconciliations || []) as SnapshotSources['reconciliations'],
        journals,
        payRuns,
        fxRevaluationRuns,
        cutoverPackages,
        periods,
      }
      setSources(next)
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Failed to load period-close sources')
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => {
    void loadSources()
  }, [scope.selectedBookId, scope.selectedEntityId, scope.scopeReady]) // eslint-disable-line react-hooks/exhaustive-deps

  async function evaluate() {
    if (!sources) throw new Error('Load sources first')
    setBusy(true)
    scope.setError(null)
    scope.setMessage(null)
    try {
      const openPeriod = sources.periods.find((p) => String(p.status).toLowerCase() === 'open')
      const result = await scope.runCommand('/api/v1/finance/operator-depth/commands', 'period-close.evaluate', {
        asOfDate,
        periodId: openPeriod?.id,
        periodLabel: openPeriod ? `${openPeriod.fiscalYear || ''}-P${openPeriod.periodNumber || ''}` : undefined,
        reconciliations: sources.reconciliations,
        journals: sources.journals,
        payRuns: sources.payRuns,
        fxRevaluationRuns: sources.fxRevaluationRuns,
        cutoverPackages: sources.cutoverPackages,
        requireFxReval,
        requireCutoverComplete,
      })
      setCentre(result as PeriodCloseCommandCentre)
      scope.setMessage(
        (result as PeriodCloseCommandCentre)?.readyToClose
          ? 'No close blockers - ready for period.close approval flow on Ledger'
          : `Close centre found ${(result as PeriodCloseCommandCentre).blockerCount} blocker(s)`,
      )
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'period-close.evaluate failed')
    } finally {
      setBusy(false)
    }
  }

  if (!scope.orgScope.orgId) {
    return <FinanceEmptyScope orgScope={scope.orgScope} />
  }

  return (
    <FinanceModuleFrame
      active="period-close"
      orgScope={scope.orgScope}
      loading={scope.loading || loading || busy}
      error={scope.error}
      message={scope.message}
      title="Period close"
      description="Command centre for close-week blockers: unreconciled banks, unapproved journals, open pay runs, missing FX reval, incomplete cutover. Deep links only - no payment initiate, no SARS submit."
    >
      <div className="space-y-4">
        <FinanceScopeBar scope={scope} />

        <Card className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <HudChip tone="neutral">No external payment initiate</HudChip>
            <HudChip tone="neutral">No SARS submit</HudChip>
            <HudChip tone="neutral">Evaluate only</HudChip>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm">
              As of
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm pt-6">
              <input type="checkbox" checked={requireFxReval} onChange={(e) => setRequireFxReval(e.target.checked)} />
              Require FX reval
            </label>
            <label className="flex items-center gap-2 text-sm pt-6">
              <input type="checkbox" checked={requireCutoverComplete} onChange={(e) => setRequireCutoverComplete(e.target.checked)} />
              Require cutover complete
            </label>
            <div className="flex items-end gap-2">
              <Button type="button" disabled={busy || !scope.scopeReady} onClick={() => void loadSources()}>
                Refresh sources
              </Button>
              <Button type="button" disabled={busy || !sources} onClick={() => void evaluate()}>
                Evaluate blockers
              </Button>
            </div>
          </div>
          {sources ? (
            <p className="text-xs text-[var(--color-pib-text-muted)]">
              Snapshot: {sources.reconciliations.length} recon · {sources.journals.length} journals · {sources.payRuns.length} pay runs ·{' '}
              {sources.fxRevaluationRuns.length} FX revals · {sources.cutoverPackages.length} cutover packs
            </p>
          ) : (
            <div className="pib-empty-state !py-6">
              <p className="pib-empty-state-description">Select entity/book to load close sources.</p>
            </div>
          )}
        </Card>

        {!centre && !loading ? (
          <div className="pib-empty-state">
            <Icon name="rule" />
            <h3 className="pib-empty-state-title">No evaluation yet</h3>
            <p className="pib-empty-state-description">Refresh sources, then evaluate blockers for this book.</p>
          </div>
        ) : null}

        {centre ? (
          <Card className="p-4 space-y-4" data-testid="period-close-centre">
            <div className="flex flex-wrap items-center gap-2">
              <HudChip tone={centre.readyToClose ? 'success' : 'warning'}>
                {centre.readyToClose ? 'Ready to close' : 'Blocked'}
              </HudChip>
              <HudChip tone="neutral">{centre.blockerCount} blockers</HudChip>
              <HudChip tone="neutral">{centre.warningCount} warnings</HudChip>
              {centre.periodLabel ? <HudChip tone="neutral">{centre.periodLabel}</HudChip> : null}
            </div>

            {centre.blockers.length === 0 ? (
              <div className="pib-empty-state !py-6">
                <h3 className="pib-empty-state-title">No blockers</h3>
                <p className="pib-empty-state-description">
                  Proceed to Ledger for period.close approval (SOD). This screen never initiates bank or SARS actions.
                </p>
                <Link className="text-sm underline" href={scopedPortalPath('/portal/finance/ledger', scope.orgScope)}>
                  Open ledger
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {centre.blockers.map((blocker) => (
                  <div
                    key={blocker.code}
                    className="border border-[var(--color-pib-line)] p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                    data-testid={`period-close-blocker-${blocker.code}`}
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[var(--color-pib-text)]">{blocker.title}</span>
                        <HudChip tone={blocker.severity === 'blocker' ? 'warning' : 'neutral'}>{blocker.severity}</HudChip>
                        <HudChip tone="neutral">×{blocker.count}</HudChip>
                      </div>
                      <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">{blocker.detail}</p>
                      {blocker.itemIds.length > 0 ? (
                        <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                          ids: {blocker.itemIds.slice(0, 8).join(', ')}
                          {blocker.itemIds.length > 8 ? '…' : ''}
                        </p>
                      ) : null}
                    </div>
                    <Link href={blocker.href} className="shrink-0">
                      <Button type="button" size="sm" variant="secondary">
                        Open
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ) : null}

        <Card className="p-4">
          <h2 className="text-sm">Related operator density</h2>
          <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
            AR/AP advanced filters, saved views, select-all-filtered bulk plans, and multi-invoice/overpay allocation planning live on Documents.
            Amounts stay in minor units ({formatMinor(0, scope.selectedBook?.functionalCurrency || 'ZAR')} scale).
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={scopedPortalPath('/portal/finance/documents', scope.orgScope)}>
              <Button type="button" size="sm" variant="secondary">
                AR / AP operator lists
              </Button>
            </Link>
            <Link href={scopedPortalPath('/portal/finance/ledger', scope.orgScope)}>
              <Button type="button" size="sm" variant="secondary">
                Ledger periods
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </FinanceModuleFrame>
  )
}
