'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { HudChip } from '@/components/ui/HudChip'
import { StatCard } from '@/components/ui/StatCard'
import { FinanceModuleFrame, FinanceEmptyScope } from '@/components/finance/FinanceModuleFrame'
import {
  newFinanceId,
  readFinanceJson,
  requestIdentity,
} from '@/components/finance/financeWorkbench'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

type AnyRec = Record<string, any>

export default function FinanceProvingPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const orgId = orgScope.orgId || ''
  const [bundle, setBundle] = useState<AnyRec | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const path = scopedApiPath('/api/v1/finance/proving/queries', orgScope)
      const url = `${path}${path.includes('?') ? '&' : '?'}resource=bundle&orgId=${encodeURIComponent(orgId)}`
      const res = await fetch(url, { headers: { 'X-Org-Id': orgId } })
      const json = await readFinanceJson(res)
      if (!res.ok) throw new Error(json?.error || 'Failed to load proving bundle')
      setBundle(json?.data?.result ?? json?.result ?? json?.data ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load proving kit')
    } finally {
      setLoading(false)
    }
  }, [orgId, orgScope])

  useEffect(() => {
    void load()
  }, [load])

  async function runCommand(operation: string, command: Record<string, unknown>) {
    if (!orgId) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const identity = requestIdentity()
      const res = await fetch(scopedApiPath('/api/v1/finance/proving/commands', orgScope), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Org-Id': orgId,
        },
        body: JSON.stringify({
          operation,
          command: {
            orgId,
            ...identity,
            ...command,
          },
        }),
      })
      const json = await readFinanceJson(res)
      if (!res.ok) throw new Error(json?.error || `Command failed: ${operation}`)
      setMessage(`${operation} ok`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Command failed')
    } finally {
      setBusy(false)
    }
  }

  if (!orgId) {
    return <FinanceEmptyScope orgScope={orgScope} />
  }

  const workspace = bundle?.workspace ?? {}
  const seed = workspace.seed
  const closeRuns: AnyRec[] = workspace.closeRuns ?? []
  const packs: AnyRec[] = workspace.packagingDryRuns ?? []
  const checklist: AnyRec[] = workspace.acceptanceChecklist ?? []
  const checkedCount = checklist.filter((c) => c.checked).length
  const requiredLeft = checklist.filter((c) => c.required && !c.checked).length

  return (
    <FinanceModuleFrame
      active="proving"
      orgScope={orgScope}
      loading={loading || busy}
      title="Finance proving kit"
      description="Deterministic demo company, multi-period close fixture, packaging dry-run, and printable accountant acceptance checklist. Development/staging fixture — not a permanent CEO dashboard. No SARS submit, no payment initiate."
      error={error}
      message={message}
      meta={
        <div className="flex flex-wrap items-center gap-1.5">
          <HudChip tone="accent">Phase 5 proving</HudChip>
          <HudChip>No SARS submit</HudChip>
          <HudChip>No external payout</HudChip>
          <HudChip>Printable checklist</HudChip>
        </div>
      }
      actions={
        <div className="flex flex-wrap gap-1.5 print:hidden">
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => runCommand('proving.seed', { seedKey: 'pib-demo-proving-v1' })}
          >
            Seed demo company
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !seed}
            onClick={() =>
              runCommand('proving.close_fixture.run', {
                entityCode: 'OPS',
                periodKey: '2026-07',
                resolveBlockers: false,
              })
            }
          >
            Close fixture (show blockers)
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !seed}
            onClick={() =>
              runCommand('proving.close_fixture.run', {
                entityCode: 'OPS',
                periodKey: '2026-07',
                resolveBlockers: true,
                idempotencyKey: newFinanceId('close-resolve'),
                requestId: newFinanceId('req'),
              })
            }
          >
            Resolve + hard close
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !seed}
            onClick={() => runCommand('proving.packaging.dry_run', {})}
          >
            Packaging dry-run
          </Button>
          <Button size="sm" variant="ghost" onClick={() => window.print()}>
            Print checklist
          </Button>
          <Link href={scopedPortalPath('/portal/finance/runbooks', orgScope)} className="pib-btn-ghost btn-pib-sm">
            Runbooks
          </Link>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="finance-proving-stats">
        <StatCard label="Entities" value={String(seed?.entities?.length ?? 0)} detail="HOLD / OPS / SVC" icon="apartment" />
        <StatCard label="Journals" value={String(seed?.journals?.length ?? 0)} detail="Posted activity" icon="menu_book" />
        <StatCard label="Close runs" value={String(closeRuns.length)} detail="Blockers → freeze" icon="lock" />
        <StatCard
          label="Checklist"
          value={`${checkedCount}/${checklist.length || 12}`}
          detail={requiredLeft ? `${requiredLeft} required open` : 'Required complete'}
          icon="checklist"
        />
      </div>

      <Card className="space-y-3 p-5" data-testid="finance-proving-seed">
        <h2 className="text-base font-semibold">1. Deterministic demo company</h2>
        {seed ? (
          <div className="space-y-2 text-sm text-[var(--color-pib-text-muted)]">
            <p>
              <strong className="text-[var(--color-pib-text)]">{seed.companyName}</strong> · seedKey{' '}
              <code>{seed.seedKey}</code> · digest <code>{bundle?.seedDigest?.slice(0, 12)}…</code>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(seed.entities ?? []).map((e: AnyRec) => (
                <HudChip key={e.id}>
                  {e.code} · {e.bookCode}
                </HudChip>
              ))}
            </div>
            <p>
              AR/AP {seed.arAp?.length ?? 0} · bank {seed.bankLines?.length ?? 0} · payroll{' '}
              {seed.payrollRuns?.length ?? 0} · FX {seed.fxPositions?.length ?? 0} · assets{' '}
              {seed.assets?.length ?? 0} · job costs {seed.jobCosts?.length ?? 0}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <HudChip>sarsSubmissionInitiated=false</HudChip>
              <HudChip>externalPaymentInitiated=false</HudChip>
              <HudChip>externalEgressAllowed=false</HudChip>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            No seed yet. Run Seed demo company (admin/finance_admin). Re-running the same seedKey is idempotent.
          </p>
        )}
      </Card>

      <Card className="space-y-3 p-5" data-testid="finance-proving-close">
        <h2 className="text-base font-semibold">2. Multi-period close fixture</h2>
        {closeRuns.length === 0 ? (
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            Run close fixture on OPS 2026-07 first without resolving blockers, then resolve + hard close to freeze reports.
          </p>
        ) : (
          <div className="space-y-3">
            {closeRuns
              .slice()
              .reverse()
              .map((run) => (
                <div key={run.id} className="rounded-lg border border-[var(--color-pib-line)] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">{run.periodKey}</strong>
                    <HudChip>{run.status}</HudChip>
                    {run.freeze?.trialBalanceHash ? (
                      <HudChip tone="accent">TB {String(run.freeze.trialBalanceHash).slice(0, 10)}…</HudChip>
                    ) : null}
                  </div>
                  <ul className="mt-2 space-y-1 text-xs text-[var(--color-pib-text-muted)]">
                    {(run.blockers ?? []).map((b: AnyRec) => (
                      <li key={b.code}>
                        {b.resolved ? '✓' : '○'} {b.label}
                        {b.evidence ? ` — ${b.evidence}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-5" data-testid="finance-proving-packs">
        <h2 className="text-base font-semibold">3. Packaging dry-run (download only)</h2>
        {packs.length === 0 ? (
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            Build SARS / payment instruction / accountant packs from seeded facts. Still no submit/initiate.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="text-[var(--color-pib-text-muted)]">
                  <th className="py-1 pr-3">Kind</th>
                  <th className="py-1 pr-3">Files</th>
                  <th className="py-1 pr-3">Rows</th>
                  <th className="py-1">Gates</th>
                </tr>
              </thead>
              <tbody>
                {packs.map((p) => (
                  <tr key={p.kind} className="border-t border-[var(--color-pib-line)]">
                    <td className="py-1 pr-3 font-medium">{p.kind}</td>
                    <td className="py-1 pr-3">{(p.fileNames ?? []).join(', ')}</td>
                    <td className="py-1 pr-3">{p.rowCount}</td>
                    <td className="py-1">egress=false · sars=false · pay=false</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-5" data-testid="finance-proving-checklist">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">4. Accountant acceptance checklist</h2>
          <HudChip>{requiredLeft === 0 ? 'Required complete' : `${requiredLeft} required open`}</HudChip>
        </div>
        <p className="text-sm text-[var(--color-pib-text-muted)] print:block">
          Printable evidence steps for a one-sitting accountant acceptance. Check boxes after you verify each proof path.
        </p>
        <div className="space-y-2">
          {checklist.map((item) => (
            <label
              key={item.id}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-pib-line)] p-3 print:break-inside-avoid"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={Boolean(item.checked)}
                disabled={busy}
                onChange={(e) =>
                  runCommand('proving.checklist.toggle', {
                    itemId: item.id,
                    checked: e.target.checked,
                    idempotencyKey: newFinanceId(`chk-${item.id}`),
                    requestId: newFinanceId('req'),
                  })
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[var(--color-pib-text)]">
                  {item.step}. {item.title}
                  {item.required ? ' *' : ''}
                </span>
                <span className="mt-1 block text-xs text-[var(--color-pib-text-muted)]">{item.detail}</span>
                <span className="mt-1 block text-xs text-[var(--color-pib-text-muted)]">
                  Evidence: {item.evidenceHint}
                </span>
              </span>
              <HudChip>{item.section}</HudChip>
            </label>
          ))}
        </div>
      </Card>
    </FinanceModuleFrame>
  )
}
