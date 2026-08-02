'use client'

import { FinanceModuleFrame, FinanceEmptyScope } from '@/components/finance/FinanceModuleFrame'
import { FinanceScopeBar } from '@/components/finance/FinanceScopeBar'
import { useFinanceBookScope } from '@/components/finance/useFinanceBookScope'

export default function FinanceMultiCurrencyPage() {
  const scope = useFinanceBookScope()
  return (
    <FinanceModuleFrame
      active="multi-currency"
      orgScope={scope.orgScope}
      title="Multi-currency"
      description="FX rate sets, revaluation journals, and functional currency reports."
      error={scope.error}
      message={scope.message}
      loading={scope.loading}
    >
      {!scope.loading && !scope.scopeReady ? (
        <FinanceEmptyScope orgScope={scope.orgScope} />
      ) : !scope.loading ? (
        <>
          <FinanceScopeBar scope={scope} />
          <section className="pib-card space-y-3 p-4">
            <h2 className="text-base font-semibold">Multi-currency</h2>
            <p className="text-sm text-[var(--color-pib-text-muted)]">
              Use authenticated multi-currency commands for approved rate sets and revaluation. No external payment initiate.
            </p>
            <button
              type="button"
              className="pib-btn-ghost"
              onClick={() => {
                void fetch(scope.queryUrl('/api/v1/finance/multi-currency/queries', 'bundle'), { credentials: 'include' })
              }}
            >
              Refresh bundle
            </button>
          </section>
        </>
      ) : null}
    </FinanceModuleFrame>
  )
}
