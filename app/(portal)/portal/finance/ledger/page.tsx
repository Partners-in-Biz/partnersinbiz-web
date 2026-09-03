'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { FinanceModuleFrame, FinanceEmptyScope } from '@/components/finance/FinanceModuleFrame'
import { FinanceScopeBar } from '@/components/finance/FinanceScopeBar'
import { FinanceResponsiveTable } from '@/components/finance/FinanceResponsiveTable'
import {
  FinanceOperatorTableChrome,
  useFinanceTableDensity,
} from '@/components/finance/FinanceOperatorTableChrome'
import {
  formatMinor,
  newFinanceId,
  parseRandsToMinor,
  readFinanceJson,
  requestIdentity,
  todayISODate,
} from '@/components/finance/financeWorkbench'
import { useFinanceBookScope } from '@/components/finance/useFinanceBookScope'

export default function FinanceLedgerPage() {
  const scope = useFinanceBookScope()
  const { density, setDensity } = useFinanceTableDensity()
  const [busy, setBusy] = useState(false)
  const [periods, setPeriods] = useState<Array<Record<string, any>>>([])
  const [accounts, setAccounts] = useState<Array<Record<string, any>>>([])
  const [journals, setJournals] = useState<Array<Record<string, any>>>([])
  const [periodId, setPeriodId] = useState('')
  const [debitAccountId, setDebitAccountId] = useState('')
  const [creditAccountId, setCreditAccountId] = useState('')
  const [amount, setAmount] = useState('1000.00')
  const [description, setDescription] = useState('Manual journal')

  const load = useCallback(async () => {
    if (!scope.scopeReady) return
    try {
      const [p, a, j] = await Promise.all([
        fetch(scope.queryUrl('/api/v1/finance/foundation/queries', 'periods'), { credentials: 'include' }),
        fetch(scope.queryUrl('/api/v1/finance/foundation/queries', 'accounts'), { credentials: 'include' }),
        fetch(scope.queryUrl('/api/v1/finance/foundation/queries', 'journals', { limit: '50' }), { credentials: 'include' }),
      ])
      const pb = await readFinanceJson(p)
      const ab = await readFinanceJson(a)
      const jb = await readFinanceJson(j)
      const nextPeriods = (pb?.data?.result ?? []) as Array<Record<string, any>>
      const nextAccounts = (ab?.data?.result ?? []) as Array<Record<string, any>>
      setPeriods(nextPeriods)
      setAccounts(nextAccounts)
      setJournals((jb?.data?.result ?? []) as Array<Record<string, any>>)
      if (nextPeriods[0]?.id) setPeriodId((prev) => prev || nextPeriods.find((x) => x.status === 'open')?.id || nextPeriods[0].id)
      if (nextAccounts[0]?.id) setDebitAccountId((prev) => prev || nextAccounts[0].id)
      if (nextAccounts[1]?.id) setCreditAccountId((prev) => prev || nextAccounts[1].id)
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Failed to load ledger')
    }
  }, [scope])

  useEffect(() => {
    void load()
  }, [scope.selectedBookId, scope.selectedEntityId, scope.scopeReady]) // eslint-disable-line react-hooks/exhaustive-deps

  async function postJournal() {
    if (!scope.scopeReady) return
    setBusy(true)
    scope.setError(null)
    scope.setMessage(null)
    try {
      if (!periodId || !debitAccountId || !creditAccountId) throw new Error('Period and both accounts are required')
      const minor = parseRandsToMinor(amount)
      const id = newFinanceId('je')
      await scope.runCommand('/api/v1/finance/foundation/commands', 'journal.post', {
        id,
        periodId,
        sourceType: 'manual',
        sourceId: id,
        sourceVersion: 1,
        description,
        postingDate: todayISODate(),
        currency: scope.selectedBook?.functionalCurrency || 'ZAR',
        lines: [
          { accountId: debitAccountId, debitMinor: minor, creditMinor: 0, memo: description },
          { accountId: creditAccountId, debitMinor: 0, creditMinor: minor, memo: description },
        ],
        expectedVersion: 0,
        ...requestIdentity('je'),
      })
      scope.setMessage(`Journal ${id} posted`)
      await load()
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Post failed')
    } finally {
      setBusy(false)
    }
  }

  const currency = scope.selectedBook?.functionalCurrency || 'ZAR'

  return (
    <FinanceModuleFrame
      active="ledger"
      orgScope={scope.orgScope}
      title="Ledger"
      description="Periods, chart of accounts, and balanced journal postings for the selected book."
      error={scope.error}
      message={scope.message}
      loading={scope.loading}
    >

      {!scope.loading && !scope.scopeReady ? (
        <FinanceEmptyScope orgScope={scope.orgScope} />
      ) : !scope.loading ? (
        <>
          <FinanceScopeBar scope={scope} />
          <section className="pib-card grid gap-3 p-4 md:grid-cols-3">
            <div className="flex items-end">
              <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void load()}>Refresh</button>
            </div>
          </section>

          <section className="pib-card space-y-3 p-4">
            <h2 className="text-base">Post balanced journal</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">Period
                <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
                  <option value="">Select…</option>
                  {periods.map((p) => <option key={p.id} value={p.id}>{p.fiscalYear}-{p.periodNumber} · {p.status}</option>)}
                </select>
              </label>
              <label className="text-sm">Amount (rands)
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className="text-sm">Debit account
                <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={debitAccountId} onChange={(e) => setDebitAccountId(e.target.value)}>
                  <option value="">Select…</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
                </select>
              </label>
              <label className="text-sm">Credit account
                <select className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={creditAccountId} onChange={(e) => setCreditAccountId(e.target.value)}>
                  <option value="">Select…</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
                </select>
              </label>
              <label className="text-sm md:col-span-2">Description
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>
            </div>
            <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void postJournal()}>{busy ? 'Posting…' : 'Post journal'}</button>
          </section>

          <section className="pib-card space-y-3 p-4">
            <FinanceOperatorTableChrome surface="ledger" density={density} onDensityChange={setDensity} />
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <div className="pib-card p-4">
              <h2 className="mb-3 text-base">Chart of accounts ({accounts.length})</h2>
              <FinanceResponsiveTable
                ariaLabel="Chart of accounts"
                density={density}
                onDensityChange={setDensity}
                rows={accounts as Array<Record<string, any> & { id: string }>}
                getRowLabel={(a) => `${a.code} ${a.name}`}
                emptyTitle="No accounts yet"
                emptyDescription="Seed or create a chart of accounts for this book before posting journals."
                columns={[
                  {
                    key: 'code',
                    header: 'Account',
                    render: (a) => (
                      <span className="font-medium">
                        {a.code} · {a.name}
                      </span>
                    ),
                  },
                  {
                    key: 'type',
                    header: 'Type',
                    render: (a) => (
                      <span className="text-[var(--color-pib-text-muted)]">
                        {a.accountType} · {a.normalBalance}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
            <div className="pib-card p-4">
              <h2 className="mb-3 text-base">Recent journals ({journals.length})</h2>
              <FinanceResponsiveTable
                ariaLabel="Recent journals"
                density={density}
                onDensityChange={setDensity}
                rows={journals as Array<Record<string, any> & { id: string }>}
                getRowLabel={(j) => `${j.entryNumber ?? j.id} ${j.description || ''}`}
                emptyTitle="No journals yet"
                emptyDescription="Post a balanced journal above. Reverse, do not delete, if a correction is needed."
                columns={[
                  {
                    key: 'entry',
                    header: 'Entry',
                    render: (j) => (
                      <span className="font-medium">
                        #{j.entryNumber ?? '-'} · {j.description}
                      </span>
                    ),
                  },
                  {
                    key: 'meta',
                    header: 'Date / status / debit',
                    render: (j) => (
                      <span className="text-[var(--color-pib-text-muted)]">
                        {j.postingDate?.slice?.(0, 10)} · {j.status} ·{' '}
                        {formatMinor(j.totalDebitMinor, j.currency || currency)}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          </section>
        </>
      ) : null}
    </FinanceModuleFrame>
  )
}
