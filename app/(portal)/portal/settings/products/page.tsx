'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import { ProductModal } from '@/components/crm/ProductModal'
import type { Product } from '@/lib/products/types'

function fmtMoney(value: number, currency = 'ZAR'): string {
  const safeCurrency = currency?.trim() || 'ZAR'
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: safeCurrency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value)
  } catch {
    return `${safeCurrency} ${value.toLocaleString('en-ZA')}`
  }
}

function productHealth(product: Product): { score: number; gaps: string[] } {
  const checks = [
    { ok: Boolean(product.name?.trim()), label: 'name' },
    { ok: Boolean(product.description?.trim()), label: 'description' },
    { ok: Boolean(product.unit?.trim()), label: 'unit' },
    { ok: Number.isFinite(product.unitPrice) && product.unitPrice > 0, label: 'price' },
    { ok: Boolean(product.currency?.trim()), label: 'currency' },
  ]
  const passed = checks.filter((check) => check.ok).length
  return {
    score: Math.round((passed / checks.length) * 100),
    gaps: checks.filter((check) => !check.ok).map((check) => check.label),
  }
}

function productDisplayName(product: Product): string {
  return product.name?.trim() || 'Product name missing'
}

function productCurrencyLabel(product: Product): string {
  return product.currency?.trim() || 'Currency not set'
}

function productSearchText(product: Product): string {
  return [
    productDisplayName(product),
    product.description,
    product.unit,
    productCurrencyLabel(product),
  ].filter(Boolean).join(' ').toLowerCase()
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: string }) {
  return (
    <div className="pib-stat-card">
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow !text-[10px]">{label}</p>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{icon}</span>
      </div>
      <p className="mt-3 font-display text-3xl leading-none text-[var(--color-pib-text)]">{value}</p>
      <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">{sub}</p>
    </div>
  )
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [pendingDeleteProduct, setPendingDeleteProduct] = useState<Product | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [currencyFilter, setCurrencyFilter] = useState('')
  const [healthFilter, setHealthFilter] = useState<'all' | 'ready' | 'needs-work'>('all')

  // ── Fetch ─────────────────────────────────────────────────────────────────────

  const loadProducts = useCallback(() => {
    setLoading(true)
    setFetchError(null)
    fetch('/api/v1/crm/products')
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) {
          throw new Error(typeof body?.error === 'string' ? body.error : `Failed to load products (${r.status})`)
        }
        return body
      })
      .then((body) => {
        const list: Product[] = body.data?.products ?? body.data ?? body ?? []
        setProducts(Array.isArray(list) ? list : [])
      })
      .catch((err) => {
        setProducts([])
        setFetchError(err instanceof Error ? err.message : 'Failed to load products. Please try again.')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadProducts()
  }, [loadProducts])

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function handleOpenCreate() {
    setEditingProduct(null)
    setShowModal(true)
  }

  function handleOpenEdit(p: Product) {
    setEditingProduct(p)
    setShowModal(true)
  }

  function handleSave(saved: Product) {
    setProducts((prev) => {
      const idx = prev.findIndex((p) => p.id === saved.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = saved
        return next
      }
      return [saved, ...prev]
    })
    setShowModal(false)
    setEditingProduct(null)
  }

  function handleClose() {
    setShowModal(false)
    setEditingProduct(null)
  }

  async function handleDelete(p: Product) {
    setPendingDeleteProduct(p)
  }

  async function confirmDeleteProduct() {
    if (!pendingDeleteProduct) return
    const product = pendingDeleteProduct
    setDeletingId(product.id)
    try {
      const res = await fetch(`/api/v1/crm/products/${product.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setProducts((prev) => prev.filter((x) => x.id !== product.id))
      setPendingDeleteProduct(null)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed.')
    } finally {
      setDeletingId(null)
    }
  }

  function clearProductFilters() {
    setSearch('')
    setCurrencyFilter('')
    setHealthFilter('all')
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const activeProducts = products.filter((product) => product.active !== false)
  const zeroPriceCount = products.filter((product) => !Number.isFinite(product.unitPrice) || product.unitPrice <= 0).length
  const missingDescriptionCount = products.filter((product) => !product.description?.trim()).length
  const missingUnitCount = products.filter((product) => !product.unit?.trim()).length
  const currencyCodes = Array.from(new Set(products.map((product) => product.currency).filter(Boolean))).sort()
  const primaryCurrency = currencyCodes[0] ?? 'ZAR'
  const totalPrimaryValue = products
    .filter((product) => product.currency === primaryCurrency)
    .reduce((sum, product) => sum + (Number.isFinite(product.unitPrice) ? product.unitPrice : 0), 0)
  const avgPrimaryValue = products.filter((product) => product.currency === primaryCurrency).length > 0
    ? totalPrimaryValue / products.filter((product) => product.currency === primaryCurrency).length
    : 0
  const healthAverage = products.length > 0
    ? Math.round(products.reduce((sum, product) => sum + productHealth(product).score, 0) / products.length)
    : 0
  const filteredProducts = products.filter((product) => {
    const q = search.trim().toLowerCase()
    const matchesSearch = !q || productSearchText(product).includes(q)
    const matchesCurrency = !currencyFilter || product.currency?.trim() === currencyFilter
    const health = productHealth(product)
    const matchesHealth =
      healthFilter === 'all' ||
      (healthFilter === 'ready' && health.score >= 80) ||
      (healthFilter === 'needs-work' && health.score < 80)
    return matchesSearch && matchesCurrency && matchesHealth
  })
  const needsWorkCount = products.filter((product) => productHealth(product).score < 80).length
  const catalogBlueprint = [
    {
      label: 'Pricing',
      value: 'Unit price',
      icon: 'sell',
      copy: 'So sales can quote without guessing or rebuilding the same line item.',
    },
    {
      label: 'Units',
      value: 'Per item',
      icon: 'straighten',
      copy: 'Make retainers, hours, audits, licences, and once-off services easy to compare.',
    },
    {
      label: 'Sales copy',
      value: 'Description',
      icon: 'notes',
      copy: 'Give every employee consistent wording for proposals, deals, and handovers.',
    },
    {
      label: 'Forecasting',
      value: 'Currency',
      icon: 'monitoring',
      copy: 'Keep deal values and revenue reports trustworthy across the whole company.',
    },
  ]

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow">CRM settings</p>
          <h1 className="pib-page-title mt-2">Product catalog</h1>
          <p className="pib-page-sub max-w-2xl">
            Manage the services and products that power deal line items, quote pricing, and revenue forecasting.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenCreate}
          className="cursor-pointer btn-pib-accent flex items-center gap-1.5 text-sm shrink-0"
        >
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
          New product
        </button>
      </header>

      {!fetchError && (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Catalog items" value={String(products.length)} sub={`${activeProducts.length} active in this workspace`} icon="inventory_2" />
            <StatCard label="Catalog value" value={fmtMoney(totalPrimaryValue, primaryCurrency)} sub={`${fmtMoney(avgPrimaryValue, primaryCurrency)} average ${primaryCurrency} price`} icon="payments" />
            <StatCard label="Catalog health" value={`${healthAverage}%`} sub={`${needsWorkCount} item${needsWorkCount === 1 ? '' : 's'} need setup work`} icon="monitoring" />
            <StatCard label="Pricing gaps" value={String(zeroPriceCount)} sub={`${missingUnitCount} missing units, ${missingDescriptionCount} missing descriptions`} icon="rule_settings" />
          </section>

          <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="pib-input min-w-[220px] flex-1"
                  placeholder="Search product, unit, currency..."
                />
                <select
                  aria-label="Filter products by currency"
                  value={currencyFilter}
                  onChange={(event) => setCurrencyFilter(event.target.value)}
                  className="pib-input !w-auto"
                >
                  <option value="">All currencies</option>
                  {currencyCodes.map((currency) => (
                    <option key={currency} value={currency} className="bg-black">{currency}</option>
                  ))}
                </select>
                <select
                  aria-label="Filter products by health"
                  value={healthFilter}
                  onChange={(event) => setHealthFilter(event.target.value as 'all' | 'ready' | 'needs-work')}
                  className="pib-input !w-auto"
                >
                  <option value="all">All health</option>
                  <option value="ready">Ready</option>
                  <option value="needs-work">Needs work</option>
                </select>
              </div>

              {search || currencyFilter || healthFilter !== 'all' ? (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setCurrencyFilter(''); setHealthFilter('all') }}
                  className="btn-pib-secondary text-xs inline-flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">filter_alt_off</span>
                  Clear filters
                </button>
              ) : null}
            </div>

            <div className="bento-card !p-5 space-y-4">
              <div>
                <p className="eyebrow !text-[10px]">Catalog focus</p>
                <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
                  Quote-ready products need a price, unit, description, and currency. Gaps here become manual work in deals.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
                  <p className="font-display text-xl text-[var(--color-pib-text)]">{zeroPriceCount}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">No price</p>
                </div>
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
                  <p className="font-display text-xl text-[var(--color-pib-text)]">{missingUnitCount}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">No unit</p>
                </div>
                <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
                  <p className="font-display text-xl text-[var(--color-pib-text)]">{missingDescriptionCount}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">No copy</p>
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="pib-skeleton h-16" />)}
        </div>
      ) : fetchError ? (
        <section className="rounded-[var(--radius-card)] border border-amber-500/25 bg-amber-500/[0.07] p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-3">
              <span className="material-symbols-outlined mt-0.5 text-amber-200" aria-hidden="true">warning</span>
              <div>
                <p className="eyebrow !text-[10px] text-amber-200">Source health</p>
                <h2 className="mt-1 font-display text-xl text-[var(--color-pib-text)]">
                  Product catalog could not load
                </h2>
                <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">{fetchError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={loadProducts}
              className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 text-sm"
              aria-label="Retry loading products"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">refresh</span>
              Retry
            </button>
          </div>
        </section>
      ) : products.length === 0 ? (
        <div className="bento-card !p-0 overflow-hidden">
          <div className="grid gap-0 lg:grid-cols-[1.1fr_1.4fr]">
            <div className="border-b border-[var(--color-pib-line)] p-6 lg:border-b-0 lg:border-r">
              <span className="material-symbols-outlined mb-4 block text-[34px] text-[var(--color-accent-v2)]">inventory_2</span>
              <p className="eyebrow !text-[10px]">Catalog setup</p>
              <h2 className="mt-2 font-display text-2xl leading-tight text-[var(--color-pib-text)]">
                Build a quote-ready catalog
              </h2>
              <p className="mt-3 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                Start with the products and services your team sells most often. A clean catalog turns deal line items,
                quote pricing, and revenue forecasts into repeatable company data instead of manual admin work.
              </p>
              <button
                type="button"
                onClick={handleOpenCreate}
                className="btn-pib-accent mt-5 inline-flex cursor-pointer items-center gap-1.5 text-sm"
              >
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
                Create the first catalog item
              </button>
            </div>

            <div className="grid gap-px bg-[var(--color-pib-line)] sm:grid-cols-2">
              {catalogBlueprint.map((item) => (
                <div key={item.label} className="bg-[var(--color-pib-surface)] p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-pib-text-muted)]">{item.label}</p>
                      <p className="mt-2 font-display text-xl leading-none text-[var(--color-pib-text)]">{item.value}</p>
                    </div>
                    <span className="material-symbols-outlined text-[21px] text-[var(--color-pib-text-muted)]">{item.icon}</span>
                  </div>
                  <p className="mt-4 text-xs leading-5 text-[var(--color-pib-text-muted)]">{item.copy}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="bento-card !p-8 text-center">
          <span className="material-symbols-outlined text-[32px] text-[var(--color-pib-text-muted)] mb-3 block" aria-hidden="true">search_off</span>
          <p className="eyebrow !text-[10px]">Filtered catalog view</p>
          <h2 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">No products match this view.</h2>
          <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">Clear the product filters to return to the full quote-ready catalog.</p>
          <button
            type="button"
            onClick={clearProductFilters}
            className="btn-pib-secondary mt-5 inline-flex items-center gap-1.5 text-xs"
            aria-label="Show all products"
          >
            <span className="material-symbols-outlined text-[15px]" aria-hidden="true">filter_alt_off</span>
            Show all products
          </button>
        </div>
      ) : (
        <div className="bento-card !p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-pib-line)]">
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wider">Health</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wider">Unit</th>
                <th className="text-right px-4 py-3 text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wider">Unit Price</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wider">Currency</th>
                <th className="text-right px-4 py-3 text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((p, i) => {
                const health = productHealth(p)
                const hasDescription = Boolean(p.description?.trim())
                const pricingGaps = health.gaps.filter((gap) => gap === 'unit' || gap === 'price' || gap === 'currency')
                const displayName = productDisplayName(p)
                return (
                  <tr
                    key={p.id}
                    className={[
                      'transition-colors hover:bg-white/[0.02]',
                      i < filteredProducts.length - 1 ? 'border-b border-[var(--color-pib-line)]' : '',
                    ].join(' ')}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-[var(--color-pib-text)]">{displayName}</p>
                      <div className="mt-1 flex max-w-[360px] flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="max-w-[320px] truncate text-xs text-[var(--color-pib-text-muted)]">
                          {hasDescription ? p.description : 'No product description yet.'}
                        </p>
                        {!hasDescription && (
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(p)}
                            aria-label={`Add description for ${displayName}`}
                            className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] px-2 py-1 text-[11px] font-medium text-[var(--color-pib-text)] transition-colors hover:border-[var(--color-accent-v2)]/40 hover:bg-[var(--color-accent-v2)]/10"
                          >
                            <span className="material-symbols-outlined text-[13px]" aria-hidden="true">edit_note</span>
                            Add copy
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="min-w-[110px] space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-mono text-[var(--color-pib-text)]">{health.score}%</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${health.score >= 80 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-200'}`}>
                            {health.score >= 80 ? 'Ready' : 'Needs work'}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-pib-line-strong)]">
                          <div
                            className="h-full rounded-full bg-[var(--color-pib-accent)]"
                            style={{ width: `${health.score}%` }}
                          />
                        </div>
                        {health.gaps.length > 0 && (
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="text-[10px] text-[var(--color-pib-text-muted)]">Missing {health.gaps.join(', ')}</p>
                            {pricingGaps.length > 0 && (
                              <button
                                type="button"
                                onClick={() => handleOpenEdit(p)}
                                aria-label={`Fix pricing setup for ${displayName}`}
                                className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-[11px] font-medium text-amber-100 transition-colors hover:border-amber-200/50 hover:bg-amber-300/15"
                              >
                                <span className="material-symbols-outlined text-[13px]" aria-hidden="true">price_check</span>
                                Fix pricing
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-pib-text-muted)]">
                      {p.unit?.trim() ? p.unit : 'Unit not set'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(p.unitPrice, p.currency)}</td>
                    <td className="px-4 py-3 text-[var(--color-pib-text-muted)]">{productCurrencyLabel(p)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(p)}
                          aria-label={`Edit ${displayName}`}
                          title="Edit product"
                          className="cursor-pointer w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.06] transition-colors"
                        >
                          <span className="material-symbols-outlined text-[16px]">edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(p)}
                          disabled={deletingId === p.id}
                          aria-label={`Delete ${displayName}`}
                          title="Delete product"
                          className="cursor-pointer w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:text-red-400 hover:bg-red-400/[0.08] transition-colors disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined text-[16px]">{deletingId === p.id ? 'hourglass_empty' : 'delete'}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <ProductModal
          product={editingProduct}
          onSave={handleSave}
          onClose={handleClose}
        />
      )}

      {pendingDeleteProduct && (
        <section
          role="alertdialog"
          aria-labelledby="delete-product-title"
          aria-describedby="delete-product-description"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-4xl rounded-lg border border-red-400/30 bg-[var(--color-pib-surface)] p-4 shadow-2xl md:bottom-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex gap-3">
              <span className="material-symbols-outlined mt-0.5 text-red-300" aria-hidden="true">
                warning
              </span>
              <div>
                <p className="eyebrow !text-[10px] text-red-200">Catalog delete confirmation</p>
                <h2 id="delete-product-title" className="mt-1 font-display text-lg text-[var(--color-pib-text)]">
                  Delete catalog product &quot;{productDisplayName(pendingDeleteProduct)}&quot;?
                </h2>
                <p id="delete-product-description" className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
                  This removes the product from the active catalog used by deal line items, quotes, and revenue reporting. Historical records keep their saved line-item data.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setPendingDeleteProduct(null)}
                className="btn-pib-secondary text-xs"
                disabled={deletingId === pendingDeleteProduct.id}
                aria-label={`Cancel delete for catalog product ${productDisplayName(pendingDeleteProduct)}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteProduct}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-300/30 bg-red-400/15 px-3 py-2 text-xs font-semibold text-red-100 transition-colors hover:bg-red-400/25 disabled:opacity-50"
                disabled={deletingId === pendingDeleteProduct.id}
                aria-label={`Confirm delete catalog product ${productDisplayName(pendingDeleteProduct)}`}
              >
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                  delete
                </span>
                {deletingId === pendingDeleteProduct.id ? 'Deleting...' : 'Delete product'}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
