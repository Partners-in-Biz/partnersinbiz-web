'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { FinanceModuleFrame } from '@/components/finance/FinanceModuleFrame'
import { requestIdentity } from '@/components/finance/financeWorkbench'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { HudChip } from '@/components/ui/HudChip'
import { StatCard } from '@/components/ui/StatCard'
import { scopedApiPath, scopedPortalPath } from '@/lib/portal/scoped-routing'
import { usePortalOrgScope } from '@/lib/portal/usePortalOrgScope'
import { DEFAULT_PROVING_SEED_KEY } from '@/lib/finance/proving/constants'

type Bundle = {
  workspace: {
    orgId: string
    seed?: {
      seedKey: string
      companyName: string
      entities: Array<{ code: string; legalName: string; bookCode: string }>
      periods: Array<{ periodKey: string; status: string }>
      arAp: unknown[]
      bankLines: unknown[]
      payrollRuns: Array<{ id: string; status: string; netMinor: number }>
      fxPositions: unknown[]
      assets: unknown[]
      jobCosts: unknown[]
      journals: unknown[]
      hardGates: Record<string, boolean>
    }
    closeRuns: Array<{
      id: string
      status: string
      periodKey: string
      blockers: Array<{ code: string; label: string; resolved: boolean }>
      freeze?: {
        trialBalanceHash: string
        totalDebitMinor: number
        totalCreditMinor: number
        immutable: boolean
      }
    }>
    multiMonthPrograms?: Array<{
      id: string
      status: string
      closedPeriodCount: number
      closedEntityCount: number
      packagingPackCount: number
      entityCodes: string[]
      periodKeys: string[]
    }>
    packagingDryRuns: Array<{
      kind: string
      family: string
      fileNames: string[]
      rowCount: number
      sampleSha256: string
      sarsSubmissionInitiated: boolean
      externalPaymentInitiated: boolean
    }>
    acceptanceChecklist: Array<{
      id: string
      section: string
      step: number
      title: string
      detail: string
      evidenceHint: string
      required: boolean
      checked: boolean
    }>
    acceptancePackExports?: Array<{ id: string; contentSha256: string; title: string }>
    audit: Array<{ at: string; action: string; summary: string }>
  }
  seedDigest: string | null
  hardGates: Record<string, boolean>
  printReady: boolean
}

async function readJson(res: Response) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`)
  }
  return body
}

export default function FinanceProvingKitPage() {
  const orgScope = usePortalOrgScope()
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
      if (orgId) url.searchParams.set('orgId', orgId)
      return `${url.pathname}${url.search}`
    },
    [orgScope, orgId],
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
          command: { ...command, orgId },
        }),
      })
      return readJson(res)
    },
    [orgId, orgScope],
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
      const body = await runCommand('proving.seed', {
        seedKey,
        ...requestIdentity('prov-seed'),
      })
      const replay = Boolean(body?.data?.result?.idempotentReplay)
      setMessage(replay ? 'Seed replayed idempotently (same seedKey digest).' : 'Demo company seeded - multi-entity books + sample activity.')
    })
  }

  async function runClose(resolveBlockers: boolean) {
    await withBusy(async () => {
      const body = await runCommand('proving.close_fixture.run', {
        entityCode: 'OPS',
        periodKey: '2026-07',
        resolveBlockers,
        ...requestIdentity(resolveBlockers ? 'prov-close' : 'prov-block'),
      })
      const status = body?.data?.result?.closeRun?.status
      setMessage(
        resolveBlockers
          ? `Close fixture finished with status ${status}. Reports freeze when closed.`
          : `Close blockers evaluated - status ${status}. Resolve then re-run with blockers cleared.`,
      )
    })
  }

  async function runPackaging() {
    await withBusy(async () => {
      const body = await runCommand('proving.packaging.dry_run', { ...requestIdentity('prov-pack') })
      const n = body?.data?.result?.packs?.length ?? 0
      setMessage(`Packaging dry-run built ${n} packs (download only - no submit/initiate).`)
    })
  }

  async function runMultiMonth() {
    await withBusy(async () => {
      const body = await runCommand('proving.multi_month_close.run', {
        entityCodes: ['OPS', 'SVC'],
        periodKeys: ['2026-05', '2026-06', '2026-07'],
        resolveBlockers: true,
        runPackaging: true,
        ...requestIdentity('prov-mm'),
      })
      const p = body?.data?.result?.program
      setMessage(
        `Multi-month program ${p?.status ?? '?'}: periods=${p?.closedPeriodCount ?? 0}, entities=${p?.closedEntityCount ?? 0}, packs=${p?.packagingPackCount ?? 0}.`,
      )
    })
  }

  async function exportAcceptance() {
    await withBusy(async () => {
      const body = await runCommand('proving.acceptance_pack.export', {
        ...requestIdentity('prov-acc'),
      })
      const sha = body?.data?.result?.pack?.contentSha256?.slice?.(0, 12)
      setMessage(`Acceptance pack exported (sign-off artifact). sha=${sha ?? 'ok'}`)
    })
  }

  async function resetWorkspace() {
    await withBusy(async () => {
      await runCommand('proving.reset', {
        confirm: true,
        ...requestIdentity('prov-reset'),
      })
      setMessage('Proving workspace reset (admin/dev). Re-seed to continue.')
    })
  }

  async function toggleCheck(itemId: string, checked: boolean) {
    await withBusy(async () => {
      await runCommand('proving.checklist.toggle', {
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

  const seed = bundle?.workspace.seed
  const latestClose = bundle?.workspace.closeRuns?.[bundle.workspace.closeRuns.length - 1]
  const latestProgram = bundle?.workspace.multiMonthPrograms?.[bundle.workspace.multiMonthPrograms.length - 1]
  const latestAccPack = bundle?.workspace.acceptancePackExports?.[bundle.workspace.acceptancePackExports.length - 1]
  const packs = bundle?.workspace.packagingDryRuns ?? []
  const checklist = bundle?.workspace.acceptanceChecklist ?? []
  const requiredDone = checklist.filter((i) => i.required && i.checked).length
  const requiredTotal = checklist.filter((i) => i.required).length

  return (
    <FinanceModuleFrame
      active="proving"
      orgScope={orgScope}
      title="Finance proving kit"
      description="Deterministic demo company, multi-month close program (≥3 periods × ≥2 entities), packaging dry-run, and accountant acceptance pack export. Development/staging proof path - no SARS submit, no payment initiate."
      loading={loading}
      error={error}
      message={message}
      meta={
        <div className="flex flex-wrap items-center gap-1.5">
          <HudChip tone="accent">Phase 6 multi-month</HudChip>
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
            <StatCard label="Entities" value={String(seed?.entities.length ?? 0)} detail="Multi-entity seed" icon="apartment" />
            <StatCard
              label="Close"
              value={latestClose?.status ?? '-'}
              detail={latestClose ? latestClose.periodKey : 'Not run'}
              icon="event_available"
            />
            <StatCard label="Packs" value={String(packs.length)} detail="Dry-run downloads" icon="inventory_2" />
            <StatCard
              label="Checklist"
              value={requiredTotal ? `${requiredDone}/${requiredTotal}` : '-'}
              detail={requiredDone === requiredTotal && requiredTotal > 0 ? 'Sign-off ready' : 'In progress'}
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
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void runClose(false)} data-testid="proving-blockers-btn">
                Evaluate blockers
              </Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void runClose(true)} data-testid="proving-close-btn">
                Resolve + close + freeze
              </Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void runPackaging()} data-testid="proving-pack-btn">
                Packaging dry-run
              </Button>
              <Button variant="primary" size="sm" disabled={busy} onClick={() => void runMultiMonth()} data-testid="proving-mm-btn">
                Multi-month close program
              </Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void exportAcceptance()} data-testid="proving-acc-btn">
                Export acceptance pack
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void resetWorkspace()} data-testid="proving-reset-btn">
                Reset (admin)
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void loadBundle()}>
                Refresh
              </Button>
            </div>
            <p className="text-xs text-[var(--color-pib-text-muted)]">
              Seed is idempotent per org + seed key and posts foundation journals with IC/FX/payroll/bank history. Single close fixture still
              covers OPS 2026-07 blockers. Multi-month program hard-closes OPS+SVC across May–July, freezes TB each period, runs packaging,
              and exports a human sign-off checklist artifact (not wet signature). Reset is owner/admin only.
            </p>
            {bundle?.seedDigest ? (
              <p className="text-xs text-[var(--color-pib-text-muted)]">Seed digest: {bundle.seedDigest}</p>
            ) : null}
          </Card>

          {seed ? (
            <Card className="space-y-3 p-5" data-testid="proving-company">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base">{seed.companyName}</h2>
                <div className="flex flex-wrap gap-1.5">
                  <HudChip>{seed.seedKey}</HudChip>
                </div>
              </div>
              <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>Entities: {seed.entities.map((e) => e.code).join(', ')}</div>
                <div>
                  Periods:{' '}
                  {seed.periods
                    .slice(0, 6)
                    .map((p) => `${p.periodKey}:${p.status}`)
                    .join(', ')}
                </div>
                <div>AR/AP lines: {seed.arAp.length}</div>
                <div>Bank lines: {seed.bankLines.length}</div>
                <div>Payroll runs: {seed.payrollRuns.length}</div>
                <div>Journals: {seed.journals.length}</div>
                <div>FX positions: {seed.fxPositions.length}</div>
                <div>Assets: {seed.assets.length}</div>
                <div>Job costs: {seed.jobCosts.length}</div>
              </div>
            </Card>
          ) : null}

          {latestProgram ? (
            <Card className="space-y-3 p-5" data-testid="proving-multi-month">
              <h2 className="text-base">Multi-month close program</h2>
              <div className="flex flex-wrap gap-1.5">
                <HudChip tone="accent">{latestProgram.status}</HudChip>
                <HudChip>
                  {latestProgram.closedPeriodCount} periods · {latestProgram.closedEntityCount} entities
                </HudChip>
                <HudChip>packs {latestProgram.packagingPackCount}</HudChip>
              </div>
              <p className="text-sm text-[var(--color-pib-text-muted)]">
                {latestProgram.entityCodes?.join(', ')} × {latestProgram.periodKeys?.join(', ')} · id {latestProgram.id}
              </p>
              {latestAccPack ? (
                <p className="text-xs text-[var(--color-pib-text-muted)]">
                  Acceptance pack {latestAccPack.id} sha {latestAccPack.contentSha256}
                </p>
              ) : null}
            </Card>
          ) : null}

          {latestClose ? (
            <Card className="space-y-3 p-5" data-testid="proving-close-fixture">
              <h2 className="text-base">Latest close fixture</h2>
              <div className="flex flex-wrap gap-1.5">
                <HudChip tone="accent">{latestClose.status}</HudChip>
                <HudChip>{latestClose.periodKey}</HudChip>
                {latestClose.freeze ? (
                  <HudChip>
                    TB {latestClose.freeze.totalDebitMinor === latestClose.freeze.totalCreditMinor ? 'balanced' : 'unbalanced'}
                  </HudChip>
                ) : null}
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-pib-text-muted)]">
                {latestClose.blockers.map((b) => (
                  <li key={b.code}>
                    {b.resolved ? '✓' : '•'} {b.code} - {b.label}
                  </li>
                ))}
              </ul>
              {latestClose.freeze ? (
                <p className="text-xs text-[var(--color-pib-text-muted)]">Freeze hash: {latestClose.freeze.trialBalanceHash}</p>
              ) : null}
            </Card>
          ) : null}

          {packs.length > 0 ? (
            <Card className="space-y-3 p-5" data-testid="proving-packaging">
              <h2 className="text-base">Packaging dry-run</h2>
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
                    {packs.map((pack) => (
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

          <Card className="space-y-4 p-5 print:shadow-none" data-testid="proving-acceptance-checklist">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base">Accountant acceptance checklist</h2>
                <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
                  Printable evidence checkboxes for a one-sitting proving run. Not a permanent CEO dashboard.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <HudChip tone={requiredDone === requiredTotal && requiredTotal > 0 ? 'accent' : undefined}>
                  {requiredDone === requiredTotal && requiredTotal > 0 ? 'Sign-off ready' : 'Incomplete'}
                </HudChip>
                <Button variant="ghost" size="sm" onClick={printChecklist} data-testid="proving-print-checklist">
                  Print checklist
                </Button>
              </div>
            </div>
            <div className="space-y-3">
              {(checklist.length ? checklist : []).map((item) => (
                <label
                  key={item.id}
                  className="flex gap-3 rounded-lg border border-[var(--color-pib-line)] p-3"
                  data-testid={`proving-check-${item.id}`}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={item.checked}
                    disabled={busy || !checklist.length}
                    onChange={(e) => void toggleCheck(item.id, e.target.checked)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {item.step}. {item.title}
                      </span>
                      <HudChip>{item.section}</HudChip>
                      {item.required ? <HudChip>Required</HudChip> : <HudChip>Optional</HudChip>}
                    </span>
                    <span className="mt-1 block text-sm text-[var(--color-pib-text-muted)]">{item.detail}</span>
                    <span className="mt-1 block text-xs text-[var(--color-pib-text-muted)]">Evidence: {item.evidenceHint}</span>
                  </span>
                </label>
              ))}
              {!checklist.length ? (
                <p className="text-sm text-[var(--color-pib-text-muted)]">Load or seed the proving kit to populate checklist items.</p>
              ) : null}
            </div>
          </Card>
        </>
      )}
    </FinanceModuleFrame>
  )
}
