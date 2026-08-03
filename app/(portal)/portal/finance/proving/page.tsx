'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FinanceModuleFrame } from '@/components/finance/FinanceModuleFrame'
import { requestIdentity } from '@/components/finance/financeWorkbench'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { HudChip } from '@/components/ui/HudChip'
import { StatCard } from '@/components/ui/StatCard'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import { useSearchParams } from 'next/navigation'
import { DEFAULT_PROVING_SEED_KEY } from '@/lib/finance/proving/constants'

type Bundle = {
  company: null | {
    label: string
    seedKey: string
    version: string
    entities: unknown[]
    books: unknown[]
    periods: Array<{ id: string; label: string; status: string }>
    arDocuments: unknown[]
    apDocuments: unknown[]
    bankLines: unknown[]
    payRun: { id: string; status: string; netPayMinor: number }
    fxRates: unknown[]
    assets: unknown[]
    jobDimensions: unknown[]
    hardGates: Record<string, boolean>
  }
  latestCloseFixture: null | {
    periodId: string
    periodAfterStatus: string
    blockersBefore: Array<{ code: string; title: string }>
    blockersAfter: Array<{ code: string; title: string }>
    timeline: Array<{ step: string; detail: string }>
    reportFreeze: {
      periodStatus: string
      trialBalanceBalanced: boolean
      inputDigest: string
      postingBlockedWithoutAdjustment: boolean
      hardClosedBlocksAllPosting: boolean
    }
    hardGates: Record<string, boolean>
  }
  latestPackagingWalkthrough: null | {
    packs: Array<{
      kind: string
      family: string
      fileNames: string[]
      rowCount: number
      sarsSubmissionInitiated: boolean
      externalPaymentInitiated: boolean
    }>
    hardGates: Record<string, boolean>
  }
  checklist: {
    items: Array<{
      id: string
      section: string
      title: string
      detail: string
      evidenceHint: string
      required: boolean
      printableOrder: number
    }>
    checks: Record<string, { checked: boolean; note?: string }>
    completedRequiredCount: number
    requiredCount: number
    readyForAccountantSignoff: boolean
    hardGates: Record<string, boolean>
  }
  hardGates: Record<string, boolean>
}

async function readJson(res: Response) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`)
  }
  return body
}

export default function FinanceProvingKitPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const orgId = orgScope.orgId || ''
  const [seedKey, setSeedKey] = useState(DEFAULT_PROVING_SEED_KEY)
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const queryUrl = useCallback(
    (resource: string) => {
      const base = scopedApiPath('/api/v1/finance/proving/queries', orgScope)
      const url = new URL(base, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
      url.searchParams.set('resource', resource)
      url.searchParams.set('seedKey', seedKey)
      if (orgId) url.searchParams.set('orgId', orgId)
      return `${url.pathname}${url.search}`
    },
    [orgScope, orgId, seedKey],
  )

  const runCommand = useCallback(
    async (operation: string, command: Record<string, unknown>) => {
      if (!orgId) throw new Error('Select an organization scope first')
      const res = await fetch(scopedApiPath('/api/v1/finance/proving/commands', orgScope), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Org-Id': orgId,
        },
        body: JSON.stringify({
          operation,
          command: { ...command, orgId, seedKey },
        }),
      })
      return readJson(res)
    },
    [orgId, orgScope, seedKey],
  )

  const loadBundle = useCallback(async () => {
    if (!orgId) {
      setBundle(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(queryUrl('bundle'), {
        credentials: 'include',
        headers: { 'X-Org-Id': orgId },
      })
      const body = await readJson(res)
      setBundle((body?.data?.result ?? null) as Bundle | null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load proving kit')
    } finally {
      setLoading(false)
    }
  }, [orgId, queryUrl])

  useEffect(() => {
    void loadBundle()
  }, [loadBundle])

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await fn()
      await loadBundle()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Proving kit command failed')
    } finally {
      setBusy(false)
    }
  }

  async function seedCompany() {
    await withBusy(async () => {
      await runCommand('proving.seed', { ...requestIdentity('prov-seed') })
      setMessage('Demo company seeded (idempotent). Multi-entity books + AR/AP/bank/payroll/FX/assets/jobs.')
    })
  }

  async function runClose() {
    await withBusy(async () => {
      await runCommand('proving.close_fixture', {
        closeMode: 'soft_closed',
        ...requestIdentity('prov-close'),
      })
      setMessage('Multi-period close fixture complete — blockers cleared, period soft-closed, reports frozen.')
    })
  }

  async function runPackaging() {
    await withBusy(async () => {
      await runCommand('proving.packaging_walkthrough', { ...requestIdentity('prov-pack') })
      setMessage('Packaging dry-run built SARS / payment / accountant packs (download only — no submit/initiate).')
    })
  }

  async function toggleCheck(itemId: string, checked: boolean) {
    await withBusy(async () => {
      await runCommand('proving.checklist.set', {
        itemId,
        checked,
        ...requestIdentity('prov-check'),
      })
      setMessage(checked ? `Checked ${itemId}` : `Unchecked ${itemId}`)
    })
  }

  function printChecklist() {
    if (typeof window !== 'undefined') window.print()
  }

  const company = bundle?.company
  const closeFx = bundle?.latestCloseFixture
  const packs = bundle?.latestPackagingWalkthrough
  const checklist = bundle?.checklist

  return (
    <FinanceModuleFrame
      active="proving"
      orgScope={orgScope}
      title="Finance proving kit"
      description="Deterministic demo company, multi-period close fixture, packaging dry-run, and accountant acceptance checklist. Development/staging proof path — no SARS submit, no payment initiate."
      loading={loading}
      error={error}
      message={message}
      meta={
        <div className="flex flex-wrap items-center gap-1.5">
          <HudChip tone="accent">Phase 5 proving kit</HudChip>
          <HudChip>No SARS submit</HudChip>
          <HudChip>No external payout</HudChip>
          <HudChip>Idempotent seed</HudChip>
        </div>
      }
      actions={
        <div className="flex flex-wrap gap-1.5">
          <Link href={scopedPortalPath('/portal/finance/runbooks', orgScope)} className="pib-btn-ghost btn-pib-sm">
            Runbooks
          </Link>
          <Link href={scopedPortalPath('/portal/finance/period-close', orgScope)} className="pib-btn-ghost btn-pib-sm">
            Period close
          </Link>
          <Link href={scopedPortalPath('/portal/finance/packaging', orgScope)} className="pib-btn-secondary btn-pib-sm">
            Packaging
          </Link>
        </div>
      }
    >
      {!orgId ? (
        <Card className="p-5" data-testid="proving-need-org">
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            Choose an organization in the portal scope so proving kit commands can send X-Org-Id safely.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="proving-stats">
            <StatCard
              label="Entities"
              value={String(company?.entities.length ?? 0)}
              detail="Multi-entity seed"
              icon="apartment"
            />
            <StatCard
              label="Close ready"
              value={closeFx ? closeFx.periodAfterStatus : '—'}
              detail={closeFx ? 'Fixture run' : 'Not run'}
              icon="event_available"
            />
            <StatCard
              label="Packs"
              value={String(packs?.packs.length ?? 0)}
              detail="Dry-run downloads"
              icon="inventory_2"
            />
            <StatCard
              label="Checklist"
              value={checklist ? `${checklist.completedRequiredCount}/${checklist.requiredCount}` : '—'}
              detail={checklist?.readyForAccountantSignoff ? 'Sign-off ready' : 'In progress'}
              icon="checklist"
            />
          </div>

          <Card className="space-y-4 p-5" data-testid="proving-controls">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-sm">
                <span className="text-[var(--color-pib-text-muted)]">Seed key (deterministic)</span>
                <input
                  className="rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2"
                  value={seedKey}
                  onChange={(e) => setSeedKey(e.target.value)}
                  data-testid="proving-seed-key"
                />
              </label>
              <Button variant="primary" size="sm" disabled={busy} onClick={() => void seedCompany()} data-testid="proving-seed-btn">
                Seed demo company
              </Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void runClose()} data-testid="proving-close-btn">
                Run close fixture
              </Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void runPackaging()} data-testid="proving-pack-btn">
                Packaging dry-run
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void loadBundle()}>
                Refresh
              </Button>
            </div>
            <p className="text-xs text-[var(--color-pib-text-muted)]">
              Seed is idempotent per org + seed key. Close fixture clears blockers then freezes reports. Packaging builds
              realistic SARS / payment-instruction / accountant files with egress and initiate flags forced false.
            </p>
          </Card>

          {company ? (
            <Card className="space-y-3 p-5" data-testid="proving-company">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold">{company.label}</h2>
                <div className="flex flex-wrap gap-1.5">
                  <HudChip>{company.version}</HudChip>
                  <HudChip>{company.seedKey}</HudChip>
                </div>
              </div>
              <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>Books: {company.books.length}</div>
                <div>Open/closed periods: {company.periods.map((p) => `${p.label}:${p.status}`).join(', ')}</div>
                <div>AR docs: {company.arDocuments.length}</div>
                <div>AP docs: {company.apDocuments.length}</div>
                <div>Bank lines: {company.bankLines.length}</div>
                <div>
                  Pay run: {company.payRun.status} · net R{(company.payRun.netPayMinor / 100).toFixed(2)}
                </div>
                <div>FX rates: {company.fxRates.length}</div>
                <div>Assets: {company.assets.length}</div>
                <div>Job dimensions: {company.jobDimensions.length}</div>
              </div>
            </Card>
          ) : null}

          {closeFx ? (
            <Card className="space-y-3 p-5" data-testid="proving-close-fixture">
              <h2 className="text-base font-semibold">Multi-period close fixture</h2>
              <div className="flex flex-wrap gap-1.5">
                <HudChip tone="accent">{closeFx.periodAfterStatus}</HudChip>
                <HudChip>
                  TB {closeFx.reportFreeze.trialBalanceBalanced ? 'balanced' : 'unbalanced'}
                </HudChip>
                <HudChip>posting blocked: {String(closeFx.reportFreeze.postingBlockedWithoutAdjustment)}</HudChip>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <h3 className="text-sm font-medium">Blockers before</h3>
                  <ul className="mt-1 list-disc pl-5 text-sm text-[var(--color-pib-text-muted)]">
                    {closeFx.blockersBefore.map((b) => (
                      <li key={b.code}>
                        {b.code} — {b.title}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-medium">Timeline</h3>
                  <ol className="mt-1 list-decimal pl-5 text-sm text-[var(--color-pib-text-muted)]">
                    {closeFx.timeline.map((step) => (
                      <li key={step.step}>
                        <strong>{step.step}</strong>: {step.detail}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                Freeze digest: {closeFx.reportFreeze.inputDigest}
              </p>
            </Card>
          ) : null}

          {packs ? (
            <Card className="space-y-3 p-5" data-testid="proving-packaging">
              <h2 className="text-base font-semibold">Packaging dry-run</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)]">
                      <th className="py-2 pr-3">Kind</th>
                      <th className="py-2 pr-3">Family</th>
                      <th className="py-2 pr-3">Files</th>
                      <th className="py-2 pr-3">Rows</th>
                      <th className="py-2">Gates</th>
                    </tr>
                  </thead>
                  <tbody>
                    {packs.packs.map((pack) => (
                      <tr key={pack.kind} className="border-b border-[var(--color-pib-line)]/60">
                        <td className="py-2 pr-3 font-medium">{pack.kind}</td>
                        <td className="py-2 pr-3">{pack.family}</td>
                        <td className="py-2 pr-3">{pack.fileNames.join(', ')}</td>
                        <td className="py-2 pr-3">{pack.rowCount}</td>
                        <td className="py-2">
                          submit={String(pack.sarsSubmissionInitiated)} · pay=
                          {String(pack.externalPaymentInitiated)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          {checklist ? (
            <Card className="space-y-4 p-5 print:shadow-none" data-testid="proving-acceptance-checklist">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold">Accountant acceptance checklist</h2>
                  <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
                    Printable evidence checkboxes for a one-sitting proving run. Not a permanent CEO dashboard.
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <HudChip tone={checklist.readyForAccountantSignoff ? 'accent' : undefined}>
                    {checklist.readyForAccountantSignoff ? 'Sign-off ready' : 'Incomplete'}
                  </HudChip>
                  <Button variant="ghost" size="sm" onClick={printChecklist} data-testid="proving-print-checklist">
                    Print checklist
                  </Button>
                </div>
              </div>
              <div className="space-y-3">
                {checklist.items.map((item) => {
                  const checked = Boolean(checklist.checks[item.id]?.checked)
                  return (
                    <label
                      key={item.id}
                      className="flex gap-3 rounded-lg border border-[var(--color-pib-line)] p-3"
                      data-testid={`proving-check-${item.id}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={checked}
                        disabled={busy}
                        onChange={(e) => void toggleCheck(item.id, e.target.checked)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">
                            {item.printableOrder}. {item.title}
                          </span>
                          <HudChip>{item.section}</HudChip>
                          {item.required ? <HudChip>Required</HudChip> : <HudChip>Optional</HudChip>}
                        </span>
                        <span className="mt-1 block text-sm text-[var(--color-pib-text-muted)]">{item.detail}</span>
                        <span className="mt-1 block text-xs text-[var(--color-pib-text-muted)]">
                          Evidence: {item.evidenceHint}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </Card>
          ) : null}
        </>
      )}
    </FinanceModuleFrame>
  )
}
