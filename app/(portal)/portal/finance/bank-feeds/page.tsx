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
  connections: Array<Record<string, any>>
  syncRuns: Array<Record<string, any>>
  lines: Array<Record<string, any>>
  suggestions: Array<Record<string, any>>
  auditEvents: Array<Record<string, any>>
  hardGates?: Record<string, boolean>
}

export default function FinanceBankFeedsPage() {
  const scope = useFinanceBookScope()
  const [busy, setBusy] = useState(false)
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [label, setLabel] = useState('Mock FNB cheque (proving kit)')
  const [bankAccountId, setBankAccountId] = useState('bank_main')

  const loadBundle = useCallback(async () => {
    if (!scope.scopeReady) {
      setBundle(null)
      return
    }
    try {
      const res = await fetch(scope.queryUrl('/api/v1/finance/bank-feeds/queries', 'bundle'), {
        credentials: 'include',
      })
      const body = await readFinanceJson(res)
      setBundle((body?.data?.result ?? null) as Bundle | null)
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Failed to load bank feeds')
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
      scope.setError(err instanceof Error ? err.message : 'Bank feed command failed')
    } finally {
      setBusy(false)
    }
  }

  async function createMockConnection() {
    await withBusy(async () => {
      const id = newFinanceId('bfc')
      await scope.runCommand('/api/v1/finance/bank-feeds/commands', 'bank-feed.connection.create', {
        id,
        providerId: 'mock',
        label,
        bankAccountId,
        ...requestIdentity('bank-feed-conn'),
      })
      scope.setMessage(`Mock connection created — no secrets, no real bank egress`)
    })
  }

  async function syncNow(connectionId: string) {
    await withBusy(async () => {
      const id = newFinanceId('bfsrun')
      await scope.runCommand('/api/v1/finance/bank-feeds/commands', 'bank-feed.sync', {
        id,
        connectionId,
        noEgress: true,
        ...requestIdentity('bank-feed-sync'),
      })
      scope.setMessage('Sync complete — lines staged + suggestions pending human accept/dismiss (never auto-post)')
    })
  }

  async function disconnect(connectionId: string) {
    await withBusy(async () => {
      await scope.runCommand('/api/v1/finance/bank-feeds/commands', 'bank-feed.connection.disconnect', {
        id: connectionId,
        ...requestIdentity('bank-feed-disc'),
      })
      scope.setMessage(`Disconnected ${connectionId}`)
    })
  }

  async function resolve(id: string, op: 'bank-feed.suggestion.accept' | 'bank-feed.suggestion.dismiss') {
    await withBusy(async () => {
      await scope.runCommand('/api/v1/finance/bank-feeds/commands', op, {
        id,
        resolutionNote: op.endsWith('accept')
          ? 'Operator accepted coding suggestion (no journal/payment auto-post)'
          : 'Dismissed',
        ...requestIdentity('bank-feed-resolve'),
      })
      scope.setMessage(
        op.endsWith('accept')
          ? `Accepted ${id} (still no journal/payment initiation)`
          : `Dismissed ${id}`,
      )
    })
  }

  const fmtZar = (minor: number) =>
    new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format((minor || 0) / 100)

  return (
    <FinanceModuleFrame
      active="bank-feeds"
      orgScope={scope.orgScope}
      title="Bank feeds"
      description="Connector framework (mock SA bank first). Sync pulls lines and bank-rule style suggestions — human accept/dismiss only. Never auto-posts journals and never initiates payments. No paid open-banking vendor."
      error={scope.error}
      message={scope.message}
      loading={scope.loading || busy}
    >
      {!scope.loading && !scope.scopeReady ? (
        <FinanceEmptyScope orgScope={scope.orgScope} />
      ) : !scope.loading ? (
        <div className="space-y-6">
          <FinanceScopeBar scope={scope} />

          <section className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <h2 className="mb-2 text-sm font-semibold">Hard gates</h2>
            <p className="text-xs text-[var(--color-pib-text-muted)]">
              noEgress={String(bundle?.hardGates?.noEgress ?? true)} · autoPosted=
              {String(bundle?.hardGates?.autoPosted ?? false)} · externalPaymentInitiated=
              {String(bundle?.hardGates?.externalPaymentInitiated ?? false)} · SARS submit=false · paid vendor=not
              connected
            </p>
          </section>

          <section className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <h2 className="mb-3 text-sm font-semibold">Create mock connection</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs">
                Label
                <input
                  className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
              <label className="text-xs">
                PiB bank account id
                <input
                  className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                  value={bankAccountId}
                  onChange={(e) => setBankAccountId(e.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              disabled={busy}
              className="mt-3 rounded bg-[var(--color-pib-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
              onClick={() => void createMockConnection()}
            >
              Connect mock SA bank
            </button>
          </section>

          <section className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <h2 className="mb-3 text-sm font-semibold">Connections ({bundle?.connections?.length ?? 0})</h2>
            <ul className="space-y-2 text-sm">
              {(bundle?.connections || []).map((c) => (
                <li key={c.id} className="rounded border border-[var(--color-pib-line)] px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">
                        {c.label}{' '}
                        <span className="text-[var(--color-pib-text-muted)]">
                          · {c.providerId} · {c.status}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--color-pib-text-muted)]">
                        bank={c.bankAccountId} · external={c.externalAccountId || '—'} · lastSync=
                        {c.lastSyncAt || 'never'} · cursor={c.cursor || '—'}
                      </div>
                      {c.lastError ? <div className="text-xs text-red-600">{c.lastError}</div> : null}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy || c.status === 'disconnected'}
                        className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                        onClick={() => void syncNow(c.id)}
                      >
                        Sync now
                      </button>
                      <button
                        type="button"
                        disabled={busy || c.status === 'disconnected'}
                        className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                        onClick={() => void disconnect(c.id)}
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                </li>
              ))}
              {!bundle?.connections?.length ? (
                <li className="text-[var(--color-pib-text-muted)]">No connections yet — create a mock feed above.</li>
              ) : null}
            </ul>
          </section>

          <section className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <h2 className="mb-3 text-sm font-semibold">Synced lines ({bundle?.lines?.length ?? 0})</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)]">
                    <th className="py-1 pr-2">Date</th>
                    <th className="py-1 pr-2">Description</th>
                    <th className="py-1 pr-2">Amount</th>
                    <th className="py-1 pr-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(bundle?.lines || []).slice(0, 40).map((l) => (
                    <tr key={l.id} className="border-b border-[var(--color-pib-line)]/60">
                      <td className="py-1 pr-2 whitespace-nowrap">{l.effectiveDate}</td>
                      <td className="py-1 pr-2">{l.description}</td>
                      <td className="py-1 pr-2 whitespace-nowrap">{fmtZar(l.amountMinor)}</td>
                      <td className="py-1 pr-2">{l.importStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!bundle?.lines?.length ? (
                <p className="text-[var(--color-pib-text-muted)]">No lines yet — run Sync now on a connection.</p>
              ) : null}
            </div>
          </section>

          <section className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <h2 className="mb-3 text-sm font-semibold">Suggestions ({bundle?.suggestions?.length ?? 0})</h2>
            <ul className="space-y-2 text-sm">
              {(bundle?.suggestions || []).map((s) => (
                <li key={s.id} className="rounded border border-[var(--color-pib-line)] px-3 py-2">
                  <div className="font-medium">
                    {s.kind} · {s.status} · conf {Math.round((s.confidence || 0) * 100)}%
                  </div>
                  <div className="text-xs text-[var(--color-pib-text-muted)]">{s.reason}</div>
                  {s.status === 'pending' ? (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                        onClick={() => void resolve(s.id, 'bank-feed.suggestion.accept')}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                        onClick={() => void resolve(s.id, 'bank-feed.suggestion.dismiss')}
                      >
                        Dismiss
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
              {!bundle?.suggestions?.length ? (
                <li className="text-[var(--color-pib-text-muted)]">No suggestions yet.</li>
              ) : null}
            </ul>
          </section>

          <section className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
            <h2 className="mb-3 text-sm font-semibold">Audit log ({bundle?.auditEvents?.length ?? 0})</h2>
            <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
              {(bundle?.auditEvents || []).map((a) => (
                <li key={a.id} className="border-b border-[var(--color-pib-line)]/50 py-1">
                  <span className="text-[var(--color-pib-text-muted)]">{a.at}</span> · {a.eventType} · {a.detail}
                </li>
              ))}
              {!bundle?.auditEvents?.length ? (
                <li className="text-[var(--color-pib-text-muted)]">No audit events yet.</li>
              ) : null}
            </ul>
          </section>

          <section className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4 text-xs text-[var(--color-pib-text-muted)]">
            <h2 className="mb-2 text-sm font-semibold text-[var(--color-pib-text)]">Future live provider</h2>
            <p>
              Implement <code>BankFeedConnectorAdapter</code>, register in{' '}
              <code>createBankFeedAdapterRegistry</code>, store credentials only via approved secretRefId, keep
              noEgress in unit tests. See <code>docs/architecture/finance-bank-feed-connector.md</code>. Do not sign
              Yodlee/Stitch contracts from this surface.
            </p>
          </section>
        </div>
      ) : null}
    </FinanceModuleFrame>
  )
}
