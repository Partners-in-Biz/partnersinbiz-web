'use client'

import { useCallback, useEffect, useState } from 'react'
import { FinanceModuleFrame, FinanceEmptyScope } from '@/components/finance/FinanceModuleFrame'
import { FinanceScopeBar } from '@/components/finance/FinanceScopeBar'
import {
  formatMinor,
  newFinanceId,
  parseRandsToMinor,
  readFinanceJson,
  requestIdentity,
  todayISODate,
} from '@/components/finance/financeWorkbench'
import { useFinanceBookScope } from '@/components/finance/useFinanceBookScope'

type InventoryBundle = {
  items: Array<Record<string, any>>
  movements: Array<Record<string, any>>
  adjustments: Array<Record<string, any>>
  cogsPostings: Array<Record<string, any>>
  recentAudit: Array<Record<string, any>>
  stockOnHand: Record<string, any>
}

export default function FinanceInventoryPage() {
  const scope = useFinanceBookScope()
  const [busy, setBusy] = useState(false)
  const [bundle, setBundle] = useState<InventoryBundle | null>(null)

  const [sku, setSku] = useState('WIDGET-01')
  const [name, setName] = useState('Widget')
  const [trackQty, setTrackQty] = useState(true)
  const [billQty, setBillQty] = useState('10')
  const [billUnitCost, setBillUnitCost] = useState('50.00')
  const [invoiceQty, setInvoiceQty] = useState('2')
  const [adjDelta, setAdjDelta] = useState('-1')
  const [adjReason, setAdjReason] = useState('Stock count adjustment')
  const [selectedItemId, setSelectedItemId] = useState('')

  const loadBundle = useCallback(async () => {
    if (!scope.scopeReady) {
      setBundle(null)
      return
    }
    try {
      const res = await fetch(scope.queryUrl('/api/v1/finance/inventory/queries', 'bundle'), { credentials: 'include' })
      const body = await readFinanceJson(res)
      const next = (body?.data?.result ?? null) as InventoryBundle | null
      setBundle(next)
      if (next?.items?.[0]?.id) setSelectedItemId((prev) => prev || next.items[0].id)
    } catch (err) {
      scope.setError(err instanceof Error ? err.message : 'Failed to load inventory bundle')
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
      scope.setError(err instanceof Error ? err.message : 'Inventory command failed')
    } finally {
      setBusy(false)
    }
  }

  async function createItem() {
    await withBusy(async () => {
      const id = newFinanceId('invitem')
      await scope.runCommand('/api/v1/finance/inventory/commands', 'item.create', {
        id,
        sku,
        name,
        incomeAccountId: 'acc_income',
        cogsAccountId: 'acc_cogs',
        inventoryAssetAccountId: 'acc_inventory',
        trackQuantity: trackQty,
        currency: scope.selectedBook?.functionalCurrency || 'ZAR',
        expectedVersion: 0,
        ...requestIdentity('inv-item'),
      })
      scope.setMessage(`SKU ${sku} created (stock lite - no WMS/POS)`)
      setSelectedItemId(id)
    })
  }

  async function applyBill() {
    await withBusy(async () => {
      if (!selectedItemId) throw new Error('Select an item')
      const qty = Math.round(Number(billQty) * 1000)
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('Bill quantity must be positive')
      await scope.runCommand('/api/v1/finance/inventory/commands', 'bill-receipt.apply', {
        id: newFinanceId('billrcv'),
        billId: newFinanceId('bill'),
        billNumber: `BILL-${todayISODate()}`,
        receivedAt: todayISODate(),
        lines: [{
          itemId: selectedItemId,
          quantityMilli: qty,
          unitCostMinor: parseRandsToMinor(billUnitCost),
          sourceLineId: '1',
        }],
        ...requestIdentity('inv-bill'),
      })
      scope.setMessage('Bill receipt applied to stock on hand')
    })
  }

  async function applyInvoice() {
    await withBusy(async () => {
      if (!selectedItemId) throw new Error('Select an item')
      const qty = Math.round(Number(invoiceQty) * 1000)
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('Invoice quantity must be positive')
      const result = await scope.runCommand('/api/v1/finance/inventory/commands', 'invoice-issue.apply', {
        id: newFinanceId('invissue'),
        invoiceId: newFinanceId('inv'),
        invoiceNumber: `INV-${todayISODate()}`,
        issuedAt: todayISODate(),
        lines: [{
          itemId: selectedItemId,
          quantityMilli: qty,
          sourceLineId: '1',
        }],
        ...requestIdentity('inv-issue'),
      }) as Record<string, any>
      const cogs = result?.cogsPostings?.[0]?.cogsMinor
      scope.setMessage(
        cogs != null
          ? `Invoice issue applied; COGS ${formatMinor(cogs, scope.selectedBook?.functionalCurrency || 'ZAR')} (book journal only)`
          : 'Invoice issue applied (no tracked stock lines)',
      )
    })
  }

  async function applyAdjustment() {
    await withBusy(async () => {
      if (!selectedItemId) throw new Error('Select an item')
      const item = bundle?.items?.find((i) => i.id === selectedItemId)
      const delta = Math.round(Number(adjDelta) * 1000)
      if (!Number.isFinite(delta) || delta === 0) throw new Error('Adjustment delta must be non-zero')
      await scope.runCommand('/api/v1/finance/inventory/commands', 'adjustment.create', {
        id: newFinanceId('adj'),
        itemId: selectedItemId,
        quantityDeltaMilli: delta,
        unitCostMinor: delta > 0 ? parseRandsToMinor(billUnitCost) : undefined,
        reason: adjReason,
        adjustedAt: todayISODate(),
        expectedVersion: item?.version ?? 1,
        ...requestIdentity('inv-adj'),
      })
      scope.setMessage('Stock adjustment recorded with audit')
    })
  }

  const currency = scope.selectedBook?.functionalCurrency || bundle?.stockOnHand?.currency || 'ZAR'
  const soh = bundle?.stockOnHand

  return (
    <FinanceModuleFrame
      active="inventory"
      orgScope={scope.orgScope}
      loading={scope.loading || busy}
      error={scope.error}
      message={scope.message}
    >
      {!scope.scopeReady ? (
        <FinanceEmptyScope orgScope={scope.orgScope} />
      ) : (
        <div className="space-y-6">
          <FinanceScopeBar scope={scope} />

          <section className="border border-[var(--portal-border)] bg-[var(--portal-surface)] p-4 space-y-3">
            <h2 className="text-sm tracking-wide uppercase text-[var(--portal-muted)]">SKU / item master</h2>
            <p className="text-sm text-[var(--portal-muted)]">
              Light inventory only - quantity on hand, average cost, COGS on invoice issue. No warehouse, POS, or barcode hardware.
            </p>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="text-sm">SKU
                <input className="mt-1 w-full rounded border px-2 py-1" value={sku} onChange={(e) => setSku(e.target.value)} />
              </label>
              <label className="text-sm">Name
                <input className="mt-1 w-full rounded border px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="text-sm flex items-center gap-2 mt-6">
                <input type="checkbox" checked={trackQty} onChange={(e) => setTrackQty(e.target.checked)} />
                Track quantity
              </label>
              <div className="flex items-end">
                <button type="button" className="rounded bg-[var(--portal-accent)] px-3 py-2 text-sm text-white" onClick={() => void createItem()} disabled={busy}>
                  Create item
                </button>
              </div>
            </div>
          </section>

          <section className="border border-[var(--portal-border)] bg-[var(--portal-surface)] p-4 space-y-3">
            <h2 className="text-sm tracking-wide uppercase text-[var(--portal-muted)]">Stock movements</h2>
            <label className="text-sm block">Item
              <select
                className="mt-1 w-full rounded border px-2 py-1"
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(e.target.value)}
                aria-label="Inventory item"
              >
                <option value="">Select…</option>
                {(bundle?.items || []).map((item) => (
                  <option key={item.id} value={item.id}>{item.sku} - {item.name}</option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2 rounded border p-3">
                <div className="font-medium text-sm">Bill receipt (inbound)</div>
                <label className="text-sm">Qty
                  <input className="mt-1 w-full rounded border px-2 py-1" value={billQty} onChange={(e) => setBillQty(e.target.value)} />
                </label>
                <label className="text-sm">Unit cost
                  <input className="mt-1 w-full rounded border px-2 py-1" value={billUnitCost} onChange={(e) => setBillUnitCost(e.target.value)} />
                </label>
                <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => void applyBill()} disabled={busy}>Apply bill receipt</button>
              </div>
              <div className="space-y-2 rounded border p-3">
                <div className="font-medium text-sm">Invoice issue (outbound + COGS)</div>
                <label className="text-sm">Qty
                  <input className="mt-1 w-full rounded border px-2 py-1" value={invoiceQty} onChange={(e) => setInvoiceQty(e.target.value)} />
                </label>
                <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => void applyInvoice()} disabled={busy}>Apply invoice issue</button>
              </div>
              <div className="space-y-2 rounded border p-3">
                <div className="font-medium text-sm">Adjustment (audited)</div>
                <label className="text-sm">Delta qty
                  <input className="mt-1 w-full rounded border px-2 py-1" value={adjDelta} onChange={(e) => setAdjDelta(e.target.value)} />
                </label>
                <label className="text-sm">Reason
                  <input className="mt-1 w-full rounded border px-2 py-1" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />
                </label>
                <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => void applyAdjustment()} disabled={busy}>Post adjustment</button>
              </div>
            </div>
          </section>

          <section className="border border-[var(--portal-border)] bg-[var(--portal-surface)] p-4 space-y-3">
            <h2 className="text-sm tracking-wide uppercase text-[var(--portal-muted)]">Stock on hand</h2>
            <div className="text-sm text-[var(--portal-muted)]">
              Tracked items: {soh?.trackedItemCount ?? 0} · Value: {formatMinor(soh?.totalInventoryValueMinor ?? 0, currency)}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--portal-muted)]">
                    <th className="py-1 pr-3">SKU</th>
                    <th className="py-1 pr-3">Name</th>
                    <th className="py-1 pr-3">Qty</th>
                    <th className="py-1 pr-3">Avg cost</th>
                    <th className="py-1 pr-3">Value</th>
                    <th className="py-1 pr-3">Track</th>
                  </tr>
                </thead>
                <tbody>
                  {(soh?.lines || []).map((line: any) => (
                    <tr key={line.itemId} className="border-t border-[var(--portal-border)]">
                      <td className="py-1 pr-3 font-mono">{line.sku}</td>
                      <td className="py-1 pr-3">{line.name}</td>
                      <td className="py-1 pr-3">{(line.quantityOnHandMilli / 1000).toFixed(3)}</td>
                      <td className="py-1 pr-3">{formatMinor(line.averageUnitCostMinor || 0, currency)}</td>
                      <td className="py-1 pr-3">{formatMinor(line.inventoryValueMinor || 0, currency)}</td>
                      <td className="py-1 pr-3">{line.trackQuantity ? 'yes' : 'no'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="border border-[var(--portal-border)] bg-[var(--portal-surface)] p-4 space-y-2">
            <h2 className="text-sm tracking-wide uppercase text-[var(--portal-muted)]">Recent COGS postings</h2>
            <ul className="text-sm space-y-1">
              {(bundle?.cogsPostings || []).slice(0, 8).map((c) => (
                <li key={c.id} className="font-mono">
                  {c.sku} · qty {(c.quantityMilli / 1000).toFixed(3)} · COGS {formatMinor(c.cogsMinor || 0, currency)} · balanced={String(c.balanced)}
                </li>
              ))}
              {!bundle?.cogsPostings?.length && <li className="text-[var(--portal-muted)]">No COGS postings yet.</li>}
            </ul>
            <p className="text-xs text-[var(--portal-muted)]">Hard gates: no SARS submit, no external payment initiate, no client egress.</p>
          </section>

          <section className="border border-[var(--portal-border)] bg-[var(--portal-surface)] p-4 space-y-2">
            <h2 className="text-sm tracking-wide uppercase text-[var(--portal-muted)]">Audit</h2>
            <ul className="text-sm space-y-1 max-h-48 overflow-auto">
              {(bundle?.recentAudit || []).map((e) => (
                <li key={e.id}>{e.at} · {e.eventType} · {e.summary}</li>
              ))}
              {!bundle?.recentAudit?.length && <li className="text-[var(--portal-muted)]">No audit events yet.</li>}
            </ul>
          </section>
        </div>
      )}
    </FinanceModuleFrame>
  )
}
