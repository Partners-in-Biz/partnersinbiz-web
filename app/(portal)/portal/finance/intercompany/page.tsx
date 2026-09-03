'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { FinanceModuleFrame, FinanceEmptyScope } from '@/components/finance/FinanceModuleFrame'
import { FinanceScopeBar } from '@/components/finance/FinanceScopeBar'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'
import {
  formatMinor,
  newFinanceId,
  parseRandsToMinor,
  readFinanceJson,
  requestIdentity,
  todayISODate,
} from '@/components/finance/financeWorkbench'
import { useFinanceBookScope } from '@/components/finance/useFinanceBookScope'

type IcBundle = {
  pairs: Array<Record<string, any>>
  transactions: Array<Record<string, any>>
  eliminationRules: Array<Record<string, any>>
  consolidationRuns: Array<Record<string, any>>
  consolidationEntries: Array<Record<string, any>>
  controlBalances: Record<string, any>
  externalEgressAllowed?: boolean
}

export default function FinanceIntercompanyPage() {
  const scope = useFinanceBookScope()
  const [busy, setBusy] = useState(false)
  const [bundle, setBundle] = useState<IcBundle | null>(null)
  const [sourceEntityId, setSourceEntityId] = useState('')
  const [receivingEntityId, setReceivingEntityId] = useState('')
  const [sourceBookId, setSourceBookId] = useState('')
  const [receivingBookId, setReceivingBookId] = useState('')
  const [sourceDueFrom, setSourceDueFrom] = useState('')
  const [sourceDueTo, setSourceDueTo] = useState('')
  const [recvDueFrom, setRecvDueFrom] = useState('')
  const [recvDueTo, setRecvDueTo] = useState('')
  const [amount, setAmount] = useState('25000.00')
  const [description, setDescription] = useState('Intercompany charge')
  const [sourcePnl, setSourcePnl] = useState('')
  const [recvPnl, setRecvPnl] = useState('')

  const loadBundle = useCallback(async () => {
    if (!scope.scopeReady) {
      setBundle(null)
      return
    }
    try {
      const res = await fetch(scope.queryUrl('/api/v1/finance/intercompany/queries', 'bundle'), {
        credentials: 'include',
      })
      const body = await readFinanceJson(res)
      setBundle((body?.data?.result ?? null) as IcBundle | null)
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Failed to load intercompany bundle')
    }
  }, [scope])

  useEffect(() => {
    void loadBundle()
    if (scope.selectedEntityId) setSourceEntityId((prev) => prev || scope.selectedEntityId)
    if (scope.selectedBookId) setSourceBookId((prev) => prev || scope.selectedBookId)
  }, [scope.selectedBookId, scope.selectedEntityId, scope.scopeReady]) // eslint-disable-line react-hooks/exhaustive-deps

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true)
    scope.setError(null)
    scope.setMessage(null)
    try {
      await fn()
      await loadBundle()
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Intercompany command failed')
    } finally {
      setBusy(false)
    }
  }

  async function createPair() {
    await withBusy(async () => {
      if (!sourceEntityId || !receivingEntityId || !sourceBookId || !receivingBookId) {
        throw new Error('Source/receiving entity and book ids are required')
      }
      if (!sourceDueFrom || !sourceDueTo || !recvDueFrom || !recvDueTo) {
        throw new Error('Due-from/due-to control account ids are required for both sides')
      }
      const id = newFinanceId('icp')
      await scope.runCommand('/api/v1/finance/intercompany/commands', 'pair.create', {
        id,
        orgId: scope.orgId,
        groupOrgId: scope.orgId,
        sourceLegalEntityId: sourceEntityId,
        receivingLegalEntityId: receivingEntityId,
        sourceBookId,
        receivingBookId,
        sourceDueFromAccountId: sourceDueFrom,
        sourceDueToAccountId: sourceDueTo,
        receivingDueFromAccountId: recvDueFrom,
        receivingDueToAccountId: recvDueTo,
        enabledTransactionTypes: ['charge'],
        requireReceiveApproval: true,
        currency: scope.selectedBook?.functionalCurrency || 'ZAR',
        expectedVersion: 0,
        ...requestIdentity('ic-pair'),
      })
      scope.setMessage(`Intercompany pair ${id} created (activate before posting)`)
    })
  }

  async function activatePair(pair: Record<string, any>) {
    await withBusy(async () => {
      await scope.runCommand('/api/v1/finance/intercompany/commands', 'pair.activate', {
        pairId: pair.id,
        expectedVersion: pair.version ?? 1,
        ...requestIdentity('ic-act'),
      })
      scope.setMessage(`Pair ${pair.id} activated`)
    })
  }

  async function proposeTxn(pair: Record<string, any>) {
    await withBusy(async () => {
      if (!sourcePnl || !recvPnl) throw new Error('Source and receiving P&L account ids are required to propose')
      const id = newFinanceId('ict')
      await scope.runCommand('/api/v1/finance/intercompany/commands', 'transaction.propose', {
        id,
        orgId: scope.orgId,
        pairId: pair.id,
        transactionType: 'charge',
        amountMinor: parseRandsToMinor(amount),
        currency: pair.currency || scope.selectedBook?.functionalCurrency || 'ZAR',
        description,
        transactionDate: todayISODate(),
        sourcePnlAccountId: sourcePnl,
        receivingPnlAccountId: recvPnl,
        expectedVersion: 0,
        ...requestIdentity('ic-tx'),
      })
      scope.setMessage(`Transaction ${id} proposed - receiving entity must approve before final`)
    })
  }

  async function approveReceive(tx: Record<string, any>) {
    await withBusy(async () => {
      await scope.runCommand('/api/v1/finance/intercompany/commands', 'transaction.approve-receive', {
        transactionId: tx.id,
        expectedVersion: tx.version ?? 1,
        ...requestIdentity('ic-recv'),
      })
      scope.setMessage(`Receive side approved for ${tx.id}`)
    })
  }

  const currency = scope.selectedBook?.functionalCurrency || 'ZAR'

  return (
    <FinanceModuleFrame
      active="intercompany"
      orgScope={scope.orgScope}
      title="Intercompany"
      description="Pairs, propose/receive confirm, eliminations, and consolidation visibility."
      error={scope.error}
      message={scope.message}
      loading={scope.loading}
    >

      {!scope.loading && !scope.scopeReady ? (
        <FinanceEmptyScope orgScope={scope.orgScope} />
      ) : !scope.loading ? (
        <>
          <FinanceScopeBar scope={scope} />
          <section className="pib-card flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-xs text-[var(--color-pib-text-muted)]">
              externalEgressAllowed:{' '}
              <strong className="text-[var(--color-pib-text)]">{String(bundle?.externalEgressAllowed ?? false)}</strong>
            </p>
            <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void loadBundle()}>Refresh</button>
          </section>

          <section className="pib-card space-y-3 p-4">
            <h2 className="text-base">Create intercompany pair</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">Source legal entity id
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={sourceEntityId} onChange={(e) => setSourceEntityId(e.target.value)} />
              </label>
              <label className="text-sm">Receiving legal entity id
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={receivingEntityId} onChange={(e) => setReceivingEntityId(e.target.value)} />
              </label>
              <label className="text-sm">Source book id
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={sourceBookId} onChange={(e) => setSourceBookId(e.target.value)} />
              </label>
              <label className="text-sm">Receiving book id
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={receivingBookId} onChange={(e) => setReceivingBookId(e.target.value)} />
              </label>
              <label className="text-sm">Source due-from account
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={sourceDueFrom} onChange={(e) => setSourceDueFrom(e.target.value)} />
              </label>
              <label className="text-sm">Source due-to account
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={sourceDueTo} onChange={(e) => setSourceDueTo(e.target.value)} />
              </label>
              <label className="text-sm">Receiving due-from account
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={recvDueFrom} onChange={(e) => setRecvDueFrom(e.target.value)} />
              </label>
              <label className="text-sm">Receiving due-to account
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={recvDueTo} onChange={(e) => setRecvDueTo(e.target.value)} />
              </label>
              <label className="text-sm">Propose amount (rands)
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className="text-sm">Description
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>
              <label className="text-sm">Source P&L account id
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={sourcePnl} onChange={(e) => setSourcePnl(e.target.value)} />
              </label>
              <label className="text-sm">Receiving P&L account id
                <input className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2" value={recvPnl} onChange={(e) => setRecvPnl(e.target.value)} />
              </label>
            </div>
            <button type="button" className="pib-btn-primary" disabled={busy} onClick={() => void createPair()}>Create pair</button>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <div className="pib-card p-4">
              <h2 className="mb-3 text-base">Pairs</h2>
              {(bundle?.pairs || []).length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">No pairs yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {bundle!.pairs.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-pib-line)] pb-2">
                      <div>
                        <p className="font-medium">{p.id} · {p.status}</p>
                        <p className="text-xs text-[var(--color-pib-text-muted)]">{p.sourceLegalEntityId} → {p.receivingLegalEntityId}</p>
                      </div>
                      <div className="flex gap-2">
                        {p.status !== 'active' ? (
                          <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void activatePair(p)}>Activate</button>
                        ) : (
                          <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void proposeTxn(p)}>Propose txn</button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="pib-card p-4">
              <h2 className="mb-3 text-base">Transactions</h2>
              {(bundle?.transactions || []).length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">No intercompany transactions yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {bundle!.transactions.map((tx) => (
                    <li key={tx.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-pib-line)] pb-2">
                      <div>
                        <p className="font-medium">{tx.id} · {tx.status}</p>
                        <p className="text-xs text-[var(--color-pib-text-muted)]">{formatMinor(tx.amountMinor, tx.currency || currency)} · {tx.description || ''}</p>
                      </div>
                      {String(tx.status).includes('proposed') || String(tx.status).includes('source') ? (
                        <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => void approveReceive(tx)}>Approve receive</button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4">
                <p className="mb-2 text-sm font-medium">Consolidation runs</p>
                {(bundle?.consolidationRuns || []).length === 0 ? (
                  <p className="text-sm text-[var(--color-pib-text-muted)]">None yet. Eliminations post only into consolidation books.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {bundle!.consolidationRuns.map((run) => (
                      <li key={run.id} className="border-b border-[var(--color-pib-line)] pb-2">
                        <p className="font-medium">{run.id} · {run.status}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </FinanceModuleFrame>
  )
}
