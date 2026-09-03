'use client'

import { useCallback, useEffect, useState } from 'react'
import { FinanceModuleFrame, FinanceEmptyScope } from '@/components/finance/FinanceModuleFrame'
import { FinanceScopeBar } from '@/components/finance/FinanceScopeBar'
import {
  newFinanceId,
  readFinanceJson,
  requestIdentity,
} from '@/components/finance/financeWorkbench'
import { useFinanceBookScope } from '@/components/finance/useFinanceBookScope'

type Bundle = {
  rules: Array<Record<string, any>>
  suggestions: Array<Record<string, any>>
}

export default function FinanceBankRulesPage() {
  const scope = useFinanceBookScope()
  const [busy, setBusy] = useState(false)
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [ruleName, setRuleName] = useState('Rent payment')
  const [matchValue, setMatchValue] = useState('rent')
  const [accountId, setAccountId] = useState('acc_rent')
  const [sampleDesc, setSampleDesc] = useState('Office rent August')
  const [sampleAmount, setSampleAmount] = useState('-25000')
  const [bankAccountId, setBankAccountId] = useState('bank_main')

  const loadBundle = useCallback(async () => {
    if (!scope.scopeReady) {
      setBundle(null)
      return
    }
    try {
      const res = await fetch(scope.queryUrl('/api/v1/finance/bank-rules/queries', 'bundle'), { credentials: 'include' })
      const body = await readFinanceJson(res)
      setBundle((body?.data?.result ?? null) as Bundle | null)
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Failed to load bank rules')
    }
  }, [scope])

  useEffect(() => {
    void loadBundle()
  }, [scope.selectedBookId, scope.selectedEntityId, scope.scopeReady]) // eslint-disable-line react-hooks/exhaustive-deps

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true)
    scope.setError(null)
    scope.setMessage(null)
    try {
      await fn()
      await loadBundle()
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Bank rules command failed')
    } finally {
      setBusy(false)
    }
  }

  async function upsertRule() {
    await withBusy(async () => {
      const id = newFinanceId('brule')
      await scope.runCommand('/api/v1/finance/bank-rules/commands', 'bank-rule.upsert', {
        id,
        name: ruleName,
        priority: 10,
        status: 'active',
        match: { field: 'description', operator: 'contains', value: matchValue },
        action: { kind: 'suggest_expense_account', accountId, note: 'Suggested by bank rule' },
        ...requestIdentity('bank-rule'),
      })
      scope.setMessage(`Rule "${ruleName}" saved - suggestions only, never auto-posts`)
    })
  }

  async function evaluateSample() {
    await withBusy(async () => {
      await scope.runCommand('/api/v1/finance/bank-rules/commands', 'bank-rule.evaluate', {
        idPrefix: newFinanceId('brs'),
        bankAccountId,
        bankTransactions: [
          {
            id: newFinanceId('btx'),
            amountMinor: Number(sampleAmount),
            description: sampleDesc,
            reconciliationState: 'unmatched',
          },
        ],
        ...requestIdentity('bank-rule-eval'),
      })
      scope.setMessage('Rules evaluated - review pending suggestions (human accept/dismiss only)')
    })
  }

  async function resolve(id: string, op: 'bank-rule.suggestion.accept' | 'bank-rule.suggestion.dismiss') {
    await withBusy(async () => {
      await scope.runCommand('/api/v1/finance/bank-rules/commands', op, {
        id,
        resolutionNote: op.endsWith('accept') ? 'Operator accepted suggestion (no auto-post)' : 'Dismissed',
        ...requestIdentity('bank-rule-resolve'),
      })
      scope.setMessage(op.endsWith('accept') ? `Accepted ${id} (still no journal/payment initiation)` : `Dismissed ${id}`)
    })
  }

  return (
    <FinanceModuleFrame
      active="bank-rules"
      orgScope={scope.orgScope}
      title="Bank rules"
      description="Match rules for smarter recon suggestions. Accept/dismiss is human-gated - never auto-posts journals and never initiates payments."
      error={scope.error}
      message={scope.message}
      loading={scope.loading || busy}
    >
      {!scope.loading && !scope.scopeReady ? (
        <FinanceEmptyScope orgScope={scope.orgScope} />
      ) : !scope.loading ? (
        <div className="space-y-6">
          <FinanceScopeBar scope={scope} />
          <section className="border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <h2 className="mb-3 text-sm">Create / update rule</h2>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-xs">
                Name
                <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={ruleName} onChange={(e) => setRuleName(e.target.value)} />
              </label>
              <label className="text-xs">
                Description contains
                <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={matchValue} onChange={(e) => setMatchValue(e.target.value)} />
              </label>
              <label className="text-xs">
                Suggest expense account
                <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={accountId} onChange={(e) => setAccountId(e.target.value)} />
              </label>
            </div>
            <button type="button" disabled={busy} className="mt-3 rounded bg-[var(--color-pib-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50" onClick={() => void upsertRule()}>
              Save rule
            </button>
          </section>

          <section className="border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <h2 className="mb-3 text-sm">Evaluate sample transaction</h2>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-xs">
                Description
                <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={sampleDesc} onChange={(e) => setSampleDesc(e.target.value)} />
              </label>
              <label className="text-xs">
                Amount (minor)
                <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={sampleAmount} onChange={(e) => setSampleAmount(e.target.value)} />
              </label>
              <label className="text-xs">
                Bank account id
                <input className="mt-1 w-full rounded border px-2 py-1.5 text-sm" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} />
              </label>
            </div>
            <button type="button" disabled={busy} className="mt-3 rounded border px-3 py-1.5 text-sm disabled:opacity-50" onClick={() => void evaluateSample()}>
              Evaluate rules
            </button>
          </section>

          <section className="border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <h2 className="mb-3 text-sm">Rules ({bundle?.rules?.length ?? 0})</h2>
            <ul className="space-y-2 text-sm">
              {(bundle?.rules || []).map((r) => (
                <li key={r.id} className="rounded border border-[var(--color-pib-line)] px-3 py-2">
                  <div className="font-medium">{r.name} <span className="text-[var(--color-pib-text-muted)]">· {r.status} · p{r.priority}</span></div>
                  <div className="text-xs text-[var(--color-pib-text-muted)]">{r.match?.field} {r.match?.operator} {r.match?.value || r.match?.amountMinor} → {r.action?.kind} {r.action?.accountId || ''}</div>
                </li>
              ))}
              {!bundle?.rules?.length ? <li className="text-[var(--color-pib-text-muted)]">No rules yet.</li> : null}
            </ul>
          </section>

          <section className="border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <h2 className="mb-3 text-sm">Suggestions ({bundle?.suggestions?.length ?? 0})</h2>
            <ul className="space-y-2 text-sm">
              {(bundle?.suggestions || []).map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--color-pib-line)] px-3 py-2">
                  <div>
                    <div className="font-medium">{s.ruleName} · {s.status}</div>
                    <div className="text-xs text-[var(--color-pib-text-muted)]">{s.reason} · txn {s.bankTransactionId}</div>
                  </div>
                  {s.status === 'pending' ? (
                    <div className="flex gap-2">
                      <button type="button" className="rounded border px-2 py-1 text-xs" disabled={busy} onClick={() => void resolve(s.id, 'bank-rule.suggestion.accept')}>Accept</button>
                      <button type="button" className="rounded border px-2 py-1 text-xs" disabled={busy} onClick={() => void resolve(s.id, 'bank-rule.suggestion.dismiss')}>Dismiss</button>
                    </div>
                  ) : null}
                </li>
              ))}
              {!bundle?.suggestions?.length ? <li className="text-[var(--color-pib-text-muted)]">No suggestions yet.</li> : null}
            </ul>
          </section>
        </div>
      ) : null}
    </FinanceModuleFrame>
  )
}
