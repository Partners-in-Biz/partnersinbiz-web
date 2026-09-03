'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { FinanceModuleFrame, FinanceEmptyScope, FinancePrimaryButton } from '@/components/finance/FinanceModuleFrame'
import { FinanceScopeBar } from '@/components/finance/FinanceScopeBar'
import { FinanceResponsiveTable } from '@/components/finance/FinanceResponsiveTable'
import {
  FinanceOperatorTableChrome,
  useFinanceTableDensity,
} from '@/components/finance/FinanceOperatorTableChrome'
import {
  newFinanceId,
  readFinanceJson,
  requestIdentity,
} from '@/components/finance/financeWorkbench'
import { useFinanceBookScope } from '@/components/finance/useFinanceBookScope'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { HudChip } from '@/components/ui/HudChip'
import { StatCard } from '@/components/ui/StatCard'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'

type Health = {
  status: string
  label: string
  detail: string
  needsReconnect?: boolean
  lastSyncAt?: string
  lastError?: string
}

type Bundle = {
  connections: Array<Record<string, any> & { health?: Health; accounts?: any[] }>
  syncRuns: Array<Record<string, any>>
  lines: Array<Record<string, any>>
  suggestions: Array<Record<string, any>>
  auditEvents: Array<Record<string, any>>
  reconCentre?: {
    unreconciledCount: number
    pendingSuggestionCount: number
    aging: Array<{ bucket: string; count: number; amountMinor: number }>
    items: Array<Record<string, any>>
    safeBulkAcceptIds: string[]
    pendingSuggestionIds: string[]
    fileImportFallbackPath?: string
    hardGates?: Record<string, boolean>
  }
  hardGates?: Record<string, boolean>
}

function healthTone(status?: string): 'live' | 'warning' | 'default' | 'accent' {
  if (status === 'healthy') return 'live'
  if (status === 'syncing') return 'accent'
  if (status === 'stale') return 'warning'
  if (status === 'error' || status === 'needs_reconnect' || status === 'disconnected') return 'warning'
  return 'default'
}

export default function FinanceBankFeedsPage() {
  const scope = useFinanceBookScope()
  const { density, setDensity } = useFinanceTableDensity()
  const [busy, setBusy] = useState(false)
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [label, setLabel] = useState('Mock FNB multi-account (daily path)')
  const [bankAccountId, setBankAccountId] = useState('bank_main')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const statementsHref = useMemo(
    () => scopedPortalPath('/portal/finance/statements', scope.orgScope),
    [scope.orgScope],
  )
  const bankRulesHref = useMemo(
    () => scopedPortalPath('/portal/finance/bank-rules', scope.orgScope),
    [scope.orgScope],
  )

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
      scope.setMessage('Mock multi-account connection created - no secrets, no real bank egress')
    })
  }

  async function syncNow(connectionId: string, externalAccountId?: string) {
    await withBusy(async () => {
      const id = newFinanceId('bfsrun')
      await scope.runCommand('/api/v1/finance/bank-feeds/commands', 'bank-feed.sync', {
        id,
        connectionId,
        ...(externalAccountId ? { externalAccountId } : {}),
        noEgress: true,
        ...requestIdentity('bank-feed-sync'),
      })
      scope.setMessage(
        'Sync complete - lines materialized into recon centre; suggestions pending human accept/dismiss (never auto-post)',
      )
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

  async function reconnect(connectionId: string) {
    await withBusy(async () => {
      await scope.runCommand('/api/v1/finance/bank-feeds/commands', 'bank-feed.connection.reconnect', {
        id: connectionId,
        ...requestIdentity('bank-feed-reconn'),
      })
      scope.setMessage(`Reconnected ${connectionId} - ready for Sync now`)
    })
  }

  async function refreshAccounts(connectionId: string) {
    await withBusy(async () => {
      await scope.runCommand('/api/v1/finance/bank-feeds/commands', 'bank-feed.accounts.refresh', {
        id: connectionId,
        defaultBankAccountId: bankAccountId,
        ...requestIdentity('bank-feed-accts'),
      })
      scope.setMessage('Provider accounts refreshed - per-account cursor/status updated')
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

  async function bulk(resolution: 'accept' | 'dismiss', onlySelected: boolean) {
    await withBusy(async () => {
      const payload: Record<string, unknown> = {
        resolution,
        ...requestIdentity(`bank-feed-bulk-${resolution}`),
      }
      if (onlySelected && selected.size > 0) {
        payload.suggestionIds = [...selected]
      }
      const result = await scope.runCommand(
        '/api/v1/finance/bank-feeds/commands',
        'bank-feed.suggestion.bulk',
        payload,
      )
      const resolved = (result as any)?.resolved?.length ?? (result as any)?.data?.result?.resolved?.length ?? 0
      setSelected(new Set())
      scope.setMessage(
        resolution === 'accept'
          ? `Bulk accept (safe only): ${resolved} resolved - never auto-post`
          : `Bulk dismiss: ${resolved} resolved - never auto-post`,
      )
    })
  }

  const fmtZar = (minor: number) =>
    new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format((minor || 0) / 100)

  const recon = bundle?.reconCentre
  const pending = (bundle?.suggestions || []).filter((s) => s.status === 'pending')

  return (
    <FinanceModuleFrame
      active="bank-feeds"
      orgScope={scope.orgScope}
      title="Bank feeds"
      description="Daily operator path on the mock SA connector. Connection health, multi-account cursors, recon centre aging, and human-gated bulk accept/dismiss. File import remains the fallback. Never auto-posts journals and never initiates payments. No paid open-banking vendor."
      error={scope.error}
      message={scope.message}
      loading={scope.loading || busy}
    >
      {!scope.loading && !scope.scopeReady ? (
        <FinanceEmptyScope orgScope={scope.orgScope} />
      ) : !scope.loading ? (
        <div className="space-y-6">
          <FinanceScopeBar scope={scope} />

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Connections"
              value={String(bundle?.connections?.length ?? 0)}
              detail="Mock-first feeds"
            />
            <StatCard
              label="Unreconciled"
              value={String(recon?.unreconciledCount ?? 0)}
              detail="Recon centre queue"
            />
            <StatCard
              label="Pending suggestions"
              value={String(recon?.pendingSuggestionCount ?? pending.length)}
              detail="Human accept/dismiss only"
            />
            <StatCard
              label="Safe bulk accept"
              value={String(recon?.safeBulkAcceptIds?.length ?? 0)}
              detail="High confidence, non-SARS"
            />
          </section>

          <Card className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm">Hard gates</h2>
              <HudChip tone="live">noEgress={String(bundle?.hardGates?.noEgress ?? true)}</HudChip>
              <HudChip>autoPosted={String(bundle?.hardGates?.autoPosted ?? false)}</HudChip>
              <HudChip>
                paymentInit={String(bundle?.hardGates?.externalPaymentInitiated ?? false)}
              </HudChip>
              <HudChip tone="accent">No SARS submit</HudChip>
              <HudChip>File import fallback</HudChip>
            </div>
            <p className="text-xs text-[var(--color-pib-text-muted)]">
              Prefer continuous mock feeds for daily recon. CSV/OFX file import stays available under{' '}
              <a className="underline" href={statementsHref}>
                Statements
              </a>
              . Bank-rules evaluate surface:{' '}
              <a className="underline" href={bankRulesHref}>
                Bank rules
              </a>
              .
            </p>
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="text-sm">Create mock multi-account connection</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs">
                Label
                <input
                  className="mt-1 w-full rounded border border-[var(--color-pib-line)] bg-transparent px-2 py-1.5 text-sm"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
              <label className="text-xs">
                Default PiB bank account id
                <input
                  className="mt-1 w-full rounded border border-[var(--color-pib-line)] bg-transparent px-2 py-1.5 text-sm"
                  value={bankAccountId}
                  onChange={(e) => setBankAccountId(e.target.value)}
                />
              </label>
            </div>
            <FinancePrimaryButton disabled={busy} onClick={() => void createMockConnection()}>
              Connect mock SA bank (cheque + savings)
            </FinancePrimaryButton>
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="text-sm">Connections & health ({bundle?.connections?.length ?? 0})</h2>
            <ul className="space-y-3 text-sm">
              {(bundle?.connections || []).map((c) => {
                const health = c.health as Health | undefined
                const accounts = (c.accounts || c.linkedAccounts || []) as Array<Record<string, any>>
                return (
                  <li
                    key={c.id}
                    className="rounded-lg border border-[var(--color-pib-line)] px-3 py-3"
                    data-testid={`bank-feed-connection-${c.id}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 font-medium">
                          <span>{c.label}</span>
                          <HudChip>{c.providerId}</HudChip>
                          <HudChip tone={healthTone(health?.status)}>{health?.label || c.status}</HudChip>
                          {health?.needsReconnect ? <HudChip tone="warning">Needs reconnect</HudChip> : null}
                        </div>
                        <div className="text-xs text-[var(--color-pib-text-muted)]">
                          lastSync={health?.lastSyncAt || c.lastSyncAt || 'never'} · primary cursor=
                          {c.cursor || '-'} · default bank={c.bankAccountId}
                        </div>
                        {health?.detail ? (
                          <div className="text-xs text-[var(--color-pib-text-muted)]">{health.detail}</div>
                        ) : null}
                        {c.lastError || health?.lastError ? (
                          <div className="text-xs text-red-600">{c.lastError || health?.lastError}</div>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy || c.status === 'disconnected'}
                          onClick={() => void syncNow(c.id)}
                        >
                          Sync now
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busy || c.status === 'disconnected'}
                          onClick={() => void refreshAccounts(c.id)}
                        >
                          Refresh accounts
                        </Button>
                        {health?.needsReconnect || c.status === 'error' || c.status === 'disconnected' ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void reconnect(c.id)}
                          >
                            Reconnect
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busy || c.status === 'disconnected'}
                          onClick={() => void disconnect(c.id)}
                        >
                          Disconnect
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)]">
                            <th className="py-1 pr-2">Account</th>
                            <th className="py-1 pr-2">Status</th>
                            <th className="py-1 pr-2">Cursor</th>
                            <th className="py-1 pr-2">Last sync</th>
                            <th className="py-1 pr-2">Bank id</th>
                            <th className="py-1 pr-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {accounts.map((a) => (
                            <tr key={a.externalAccountId} className="border-b border-[var(--color-pib-line)]/50">
                              <td className="py-1 pr-2">
                                {a.name || a.externalAccountId}
                                {a.maskedAccountNumber ? ` · ${a.maskedAccountNumber}` : ''}
                              </td>
                              <td className="py-1 pr-2">
                                <HudChip tone={a.status === 'error' ? 'warning' : a.status === 'active' ? 'live' : 'default'}>
                                  {a.status}
                                </HudChip>
                              </td>
                              <td className="py-1 pr-2 whitespace-nowrap">{a.cursor || '-'}</td>
                              <td className="py-1 pr-2 whitespace-nowrap">{a.lastSyncAt || 'never'}</td>
                              <td className="py-1 pr-2">{a.bankAccountId}</td>
                              <td className="py-1 pr-2 text-right">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  disabled={busy || c.status === 'disconnected' || a.status === 'disconnected'}
                                  onClick={() => void syncNow(c.id, a.externalAccountId)}
                                >
                                  Sync account
                                </Button>
                              </td>
                            </tr>
                          ))}
                          {!accounts.length ? (
                            <tr>
                              <td colSpan={6} className="py-2 text-[var(--color-pib-text-muted)]">
                                No linked accounts - refresh after connect.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </li>
                )
              })}
              {!bundle?.connections?.length ? (
                <li className="text-[var(--color-pib-text-muted)]">No connections yet - create a mock feed above.</li>
              ) : null}
            </ul>
          </Card>

          <Card className="space-y-3 p-4" data-testid="bank-feed-recon-centre">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm">
                Operator recon centre ({recon?.unreconciledCount ?? 0} unreconciled)
              </h2>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !(recon?.safeBulkAcceptIds?.length || selected.size)}
                  onClick={() => void bulk('accept', selected.size > 0)}
                >
                  Bulk accept safe
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy || !(recon?.pendingSuggestionCount || selected.size)}
                  onClick={() => void bulk('dismiss', selected.size > 0)}
                >
                  Bulk dismiss
                </Button>
              </div>
            </div>
            <FinanceOperatorTableChrome
              surface="bank-feeds"
              density={density}
              onDensityChange={setDensity}
            />
            <div className="flex flex-wrap gap-2 text-xs">
              {(recon?.aging || []).map((bucket) => (
                <HudChip key={bucket.bucket} tone={bucket.count > 0 ? 'warning' : 'default'}>
                  {bucket.bucket}d: {bucket.count} ({fmtZar(bucket.amountMinor)})
                </HudChip>
              ))}
            </div>
            <FinanceResponsiveTable
              ariaLabel="Bank feed reconciliation suggestions"
              density={density}
              onDensityChange={setDensity}
              rows={((recon?.items || []).slice(0, 50) as Array<Record<string, any>>).map((item) => ({
                ...item,
                id: String(item.suggestionId || item.bankLineId),
              })) as Array<Record<string, any> & { id: string }>}
              selectedIds={selected}
              onToggle={(id) => {
                setSelected((prev) => {
                  const next = new Set(prev)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })
              }}
              getRowLabel={(item) =>
                String(item.description || item.suggestionId || item.bankLineId)
              }
              emptyTitle="No unreconciled feed lines"
              emptyDescription={`Run Sync now, or use file import fallback at ${statementsHref}.`}
              columns={[
                {
                  key: 'age',
                  header: 'Age',
                  render: (item) => (
                    <HudChip tone={item.agingDays > 30 ? 'warning' : item.agingDays > 7 ? 'warning' : 'default'}>
                      {item.agingBucket} ({item.agingDays}d)
                    </HudChip>
                  ),
                },
                {
                  key: 'date',
                  header: 'Date',
                  render: (item) => <span className="whitespace-nowrap">{item.effectiveDate}</span>,
                },
                {
                  key: 'desc',
                  header: 'Description',
                  render: (item) => item.description,
                },
                {
                  key: 'amount',
                  header: 'Amount',
                  render: (item) => <span className="whitespace-nowrap">{fmtZar(item.amountMinor)}</span>,
                },
                {
                  key: 'suggestion',
                  header: 'Suggestion',
                  render: (item) =>
                    item.suggestionKind ? (
                      <span>
                        {item.suggestionKind} · {item.suggestionStatus} ·{' '}
                        {Math.round((item.suggestionConfidence || 0) * 100)}%
                        {item.safeBulkAccept ? ' · safe' : ''}
                      </span>
                    ) : (
                      '-'
                    ),
                },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (item) =>
                    item.suggestionId && item.suggestionStatus === 'pending' ? (
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy}
                          onClick={() => void resolve(item.suggestionId, 'bank-feed.suggestion.accept')}
                        >
                          Accept
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void resolve(item.suggestionId, 'bank-feed.suggestion.dismiss')}
                        >
                          Dismiss
                        </Button>
                      </div>
                    ) : null,
                },
              ]}
            />
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="mb-1 text-sm">Recent synced lines ({bundle?.lines?.length ?? 0})</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)]">
                    <th className="py-1 pr-2">Date</th>
                    <th className="py-1 pr-2">Account</th>
                    <th className="py-1 pr-2">Description</th>
                    <th className="py-1 pr-2">Amount</th>
                    <th className="py-1 pr-2">Import</th>
                    <th className="py-1 pr-2">Recon</th>
                  </tr>
                </thead>
                <tbody>
                  {(bundle?.lines || []).slice(0, 40).map((l) => (
                    <tr key={l.id} className="border-b border-[var(--color-pib-line)]/60">
                      <td className="py-1 pr-2 whitespace-nowrap">{l.effectiveDate}</td>
                      <td className="py-1 pr-2 whitespace-nowrap">{l.externalAccountId}</td>
                      <td className="py-1 pr-2">{l.description}</td>
                      <td className="py-1 pr-2 whitespace-nowrap">{fmtZar(l.amountMinor)}</td>
                      <td className="py-1 pr-2">{l.importStatus}</td>
                      <td className="py-1 pr-2">{l.reconState || (l.reconMaterializedAt ? 'materialized' : '-')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-sm">Audit log ({bundle?.auditEvents?.length ?? 0})</h2>
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
          </Card>

          <Card className="space-y-2 p-4 text-xs text-[var(--color-pib-text-muted)]">
            <h2 className="text-sm text-[var(--color-pib-text)]">Safety + future live provider</h2>
            <p>
              Accept/Dismiss and bulk actions update suggestion status only - never post journals and never initiate
              payments. Mock needs no secrets. A future live provider plugs in via{' '}
              <code>BankFeedConnectorAdapter</code> + approved <code>secretRefId</code> only after a separate Peet vendor
              gate. See <code>docs/architecture/finance-bank-feed-connector.md</code>.
            </p>
          </Card>
        </div>
      ) : null}
    </FinanceModuleFrame>
  )
}
