'use client'
export const dynamic = 'force-dynamic'

import { Icon } from '@/components/studio'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ProductModal } from '@/components/crm/ProductModal'
import type { Product } from '@/lib/products/types'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import { PageHeader } from '@/components/ui/AppFoundation'

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
    <div className="pib-stat-card min-w-0" data-module-accent="cyan">
      <div className="flex items-start justify-between gap-3">
        <p className="pib-label">{label}</p>
        <Icon name={icon} />
      </div>
      <p className="mt-3 text-2xl leading-none text-[var(--color-pib-text)]">{value}</p>
      <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">{sub}</p>
    </div>
  )
}

export default function ProductsPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [pendingDeleteProduct, setPendingDeleteProduct] = useState<Product | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [currencyFilter, setCurrencyFilter] = useState('')
  const [healthFilter, setHealthFilter] = useState<'all' | 'ready' | 'needs-work'>('all')
  const openedProductRef = useRef<string | null>(null)
  const requestedProductId = searchParams.get('product')?.trim() || ''
  const productEndpoint = useCallback((path: string) => scopedApiPath(path, orgScope), [orgScope])

  // ── Fetch ─────────────────────────────────────────────────────────────────────

  const loadProducts = useCallback(() => {
    setLoading(true)
    setFetchError(null)
    fetch(productEndpoint('/api/v1/crm/products?includeInactive=true'))
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
  }, [productEndpoint])

  useEffect(() => {
    loadProducts()
  }, [loadProducts])

  useEffect(() => {
    if (!requestedProductId || openedProductRef.current === requestedProductId) return
    const selected = products.find((product) => product.id === requestedProductId)
    if (!selected) return
    openedProductRef.current = requestedProductId
    setEditingProduct(selected)
    setShowModal(true)
  }, [products, requestedProductId])

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
    setDeleteError(null)
  }

  async function confirmDeleteProduct() {
    if (!pendingDeleteProduct) return
    const product = pendingDeleteProduct
    setDeletingId(product.id)
    setDeleteError(null)
    try {
      const res = await fetch(productEndpoint(`/api/v1/crm/products/${product.id}`), { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setProducts((prev) => prev.filter((x) => x.id !== product.id))
      setPendingDeleteProduct(null)
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed.')
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
  const zeroPriceCount = activeProducts.filter((product) => !Number.isFinite(product.unitPrice) || product.unitPrice <= 0).length
  const missingDescriptionCount = activeProducts.filter((product) => !product.description?.trim()).length
  const missingUnitCount = activeProducts.filter((product) => !product.unit?.trim()).length
  const currencyCodes = Array.from(new Set(activeProducts.map((product) => product.currency).filter(Boolean))).sort()
  const primaryCurrency = currencyCodes[0] ?? 'ZAR'
  const totalPrimaryValue = activeProducts
    .filter((product) => product.currency === primaryCurrency)
    .reduce((sum, product) => sum + (Number.isFinite(product.unitPrice) ? product.unitPrice : 0), 0)
  const avgPrimaryValue = activeProducts.filter((product) => product.currency === primaryCurrency).length > 0
    ? totalPrimaryValue / activeProducts.filter((product) => product.currency === primaryCurrency).length
    : 0
  const healthAverage = activeProducts.length > 0
    ? Math.round(activeProducts.reduce((sum, product) => sum + productHealth(product).score, 0) / activeProducts.length)
    : 0
  const firstIncompleteProduct = activeProducts.find((product) => productHealth(product).score < 80)
  const firstIncompleteHealth = firstIncompleteProduct ? productHealth(firstIncompleteProduct) : null
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
  const needsWorkCount = activeProducts.filter((product) => productHealth(product).score < 80).length
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
    <div className="space-y-6">
      <PageHeader
        accent="cyan"
        eyebrow="CRM settings"
        title="Product catalog"
        description="Manage the services and products that power deal line items, quote pricing, and revenue forecasting."
        actions={(
          <button
                    type="button"
                    onClick={handleOpenCreate}
                    className="btn-pib-primary btn-pib-sm shrink-0"
                  >
                    <Icon name="add" />
                    New product
                  </button>
        )}
      />

      {!fetchError && (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Catalog items" value={String(products.length)} sub={`${activeProducts.length} active in this workspace`} icon="inventory_2" />
            <StatCard label="Catalog value" value={fmtMoney(totalPrimaryValue, primaryCurrency)} sub={`${fmtMoney(avgPrimaryValue, primaryCurrency)} average ${primaryCurrency} price`} icon="payments" />
            <StatCard label="Catalog health" value={`${healthAverage}%`} sub={`${needsWorkCount} item${needsWorkCount === 1 ? ' needs' : 's need'} setup work`} icon="monitoring" />
            <StatCard label="Pricing gaps" value={String(zeroPriceCount)} sub={`${missingUnitCount} missing units, ${missingDescriptionCount} missing descriptions`} icon="rule_settings" />
          </section>

          {firstIncompleteProduct && firstIncompleteHealth && (
            <section
              role="region"
              aria-label="Catalog readiness review"
              className="pib-card"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex gap-3">
                  <Icon name="rule_settings" />
                  <div>
                    <p className="eyebrow">Catalog readiness</p>
                    <h2 className="mt-1 text-xl">Quote readiness needs cleanup</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-pib-text-muted)]">
                      Sales teams need pricing, units, descriptions, and currencies before this catalog can support reliable quotes and forecasts.
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span className="pib-pill pib-pill-warn">
                        {productDisplayName(firstIncompleteProduct)}
                      </span>
                      <span className="text-xs text-[var(--color-pib-text-muted)]">
                        Missing {firstIncompleteHealth.gaps.join(', ')}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenEdit(firstIncompleteProduct)}
                  aria-label={`Fix catalog setup for ${productDisplayName(firstIncompleteProduct)}`}
                  className="btn-pib-secondary shrink-0"
                >
                  <Icon name="edit_note" />
                  Fix catalog setup
                </button>
              </div>
            </section>
          )}

          <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label="Search products"
                  className="pib-input min-w-[220px] flex-1"
                  placeholder="Search product, unit, currency..."
                />
                <select
                  aria-label="Filter products by currency"
                  value={currencyFilter}
                  onChange={(event) => setCurrencyFilter(event.target.value)}
                  className="pib-select !w-auto"
                >
                  <option value="">All currencies</option>
                  {currencyCodes.map((currency) => (
                    <option key={currency} value={currency}>{currency}</option>
                  ))}
                </select>
                <select
                  aria-label="Filter products by health"
                  value={healthFilter}
                  onChange={(event) => setHealthFilter(event.target.value as 'all' | 'ready' | 'needs-work')}
                  className="pib-select !w-auto"
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
                  className="btn-pib-ghost"
                >
                  <Icon name="filter_alt_off" />
                  Clear filters
                </button>
              ) : null}
            </div>

            <div className="pib-card space-y-4">
              <div>
                <p className="pib-label">Catalog focus</p>
                <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
                  Quote-ready products need a price, unit, description, and currency. Gaps here become manual work in deals.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded border border-[var(--color-pib-line)] p-3">
                  <p className="text-xl text-[var(--color-pib-text)]">{zeroPriceCount}</p>
                  <p className="pib-label mt-1">No price</p>
                </div>
                <div className="rounded border border-[var(--color-pib-line)] p-3">
                  <p className="text-xl text-[var(--color-pib-text)]">{missingUnitCount}</p>
                  <p className="pib-label mt-1">No unit</p>
                </div>
                <div className="rounded border border-[var(--color-pib-line)] p-3">
                  <p className="text-xl text-[var(--color-pib-text)]">{missingDescriptionCount}</p>
                  <p className="pib-label mt-1">No copy</p>
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
        <section className="pib-card">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-3">
              <Icon name="warning" />
              <div>
                <p className="eyebrow">Source health</p>
                <h2 className="mt-1 text-xl">
                  Product catalog could not load
                </h2>
                <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">{fetchError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={loadProducts}
              className="btn-pib-secondary shrink-0"
              aria-label="Retry loading products"
            >
              <Icon name="refresh" />
              Retry
            </button>
          </div>
        </section>
      ) : products.length === 0 ? (
        <div className="pib-card overflow-hidden !p-0">
          <div className="grid gap-0 lg:grid-cols-[1.1fr_1.4fr]">
            <div className="border-b border-[var(--color-pib-line)] p-6 lg:border-b-0 lg:border-r">
              <Icon name="inventory_2" />
              <p className="pib-label">Catalog setup</p>
              <h2 className="mt-2 text-2xl leading-tight text-[var(--color-pib-text)]">
                Build a quote-ready catalog
              </h2>
              <p className="mt-3 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                Start with the products and services your team sells most often. A clean catalog turns deal line items,
                quote pricing, and revenue forecasts into repeatable company data instead of manual admin work.
              </p>
              <button
                type="button"
                onClick={handleOpenCreate}
                className="btn-pib-primary mt-5"
              >
                <Icon name="add" />
                Create the first catalog item
              </button>
            </div>

            <div className="grid gap-px bg-[var(--color-pib-line)] sm:grid-cols-2">
              {catalogBlueprint.map((item) => (
                <div key={item.label} className="bg-[var(--color-pib-surface)] p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="pib-label">{item.label}</p>
                      <p className="mt-2 text-xl leading-none text-[var(--color-pib-text)]">{item.value}</p>
                    </div>
                    <Icon name={item.icon} />
                  </div>
                  <p className="mt-4 text-xs leading-5 text-[var(--color-pib-text-muted)]">{item.copy}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="pib-empty-state">
          <Icon name="search_off" />
          <p className="pib-label">Filtered catalog view</p>
          <h2 className="pib-empty-state-title">No products match this view.</h2>
          <p className="pib-empty-state-description">Clear the product filters to return to the full quote-ready catalog.</p>
          <div className="mt-5 flex justify-center">
            <button
              type="button"
              onClick={clearProductFilters}
              className="btn-pib-secondary"
              aria-label="Show all products"
            >
              <Icon name="filter_alt_off" />
              Show all products
            </button>
          </div>
        </div>
      ) : (
        <div className="pib-surface pib-surface-table overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-pib-line)]">
                <th className="px-4 py-3 text-left font-mono text-[0.7rem] uppercase tracking-[0.08em] text-[var(--color-pib-text-muted)]">Name</th>
                <th className="px-4 py-3 text-left font-mono text-[0.7rem] uppercase tracking-[0.08em] text-[var(--color-pib-text-muted)]">Health</th>
                <th className="px-4 py-3 text-left font-mono text-[0.7rem] uppercase tracking-[0.08em] text-[var(--color-pib-text-muted)]">Unit</th>
                <th className="px-4 py-3 text-right font-mono text-[0.7rem] uppercase tracking-[0.08em] text-[var(--color-pib-text-muted)]">Unit Price</th>
                <th className="px-4 py-3 text-left font-mono text-[0.7rem] uppercase tracking-[0.08em] text-[var(--color-pib-text-muted)]">Currency</th>
                <th className="px-4 py-3 text-right font-mono text-[0.7rem] uppercase tracking-[0.08em] text-[var(--color-pib-text-muted)]">Actions</th>
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
                      'transition-colors hover:bg-[var(--color-row-hover)]',
                      i < filteredProducts.length - 1 ? 'border-b border-[var(--color-pib-line)]' : '',
                    ].join(' ')}
                  >
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-[var(--color-pib-text)]">{displayName}</p>
                        {p.active === false && <span className="pib-pill">Inactive</span>}
                      </div>
                      <div className="mt-1 flex max-w-[360px] flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="max-w-[320px] truncate text-xs text-[var(--color-pib-text-muted)]">
                          {hasDescription ? p.description : 'No product description yet.'}
                        </p>
                        {!hasDescription && (
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(p)}
                            aria-label={`Add description for ${displayName}`}
                            className="pib-pill cursor-pointer gap-1 transition-colors hover:border-[var(--color-pib-line-strong)]"
                          >
                            <Icon name="edit_note" />
                            Add copy
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="min-w-[110px] space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs text-[var(--color-pib-text)]">{health.score}%</span>
                          <span className={`pib-pill ${p.active === false ? '' : health.score >= 80 ? 'pib-pill-success' : 'pib-pill-warn'}`}>
                            {p.active === false ? 'Inactive' : health.score >= 80 ? 'Ready' : 'Needs work'}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded bg-[var(--color-pib-line)]">
                          <div
                            className="h-full rounded bg-[var(--sc-ink-soft)]"
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
                                className="pib-pill pib-pill-warn cursor-pointer gap-1"
                              >
                                <Icon name="price_check" />
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
                          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] transition-colors hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)]"
                        >
                          <Icon name="edit" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(p)}
                          disabled={deletingId === p.id}
                          aria-label={`Delete ${displayName}`}
                          title="Delete product"
                          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] transition-colors hover:bg-[var(--color-row-hover)] hover:text-[var(--color-error)] disabled:opacity-50"
                        >
                          <Icon name={deletingId === p.id ? 'hourglass_empty' : 'delete'} />
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
          orgId={orgScope.orgId ?? undefined}
          onSave={handleSave}
          onClose={handleClose}
        />
      )}

      {pendingDeleteProduct && (
        <section
          role="alertdialog"
          aria-labelledby="delete-product-title"
          aria-describedby="delete-product-description"
          className="pib-card fixed inset-x-4 bottom-4 z-50 mx-auto max-w-4xl border-[var(--color-pib-line-strong)] md:bottom-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex gap-3">
              <Icon name="warning" />
              <div>
                <p className="eyebrow">Catalog delete confirmation</p>
                <h2 id="delete-product-title" className="mt-1 text-lg">
                  Delete catalog product &quot;{productDisplayName(pendingDeleteProduct)}&quot;?
                </h2>
                <p id="delete-product-description" className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
                  This removes the product from the active catalog used by deal line items, quotes, and revenue reporting. Historical records keep their saved line-item data.
                </p>
                {deleteError && (
                  <div
                    role="status"
                    aria-label="Catalog product delete failed"
                    className="mt-3 rounded border border-[var(--color-pib-line)] p-3"
                  >
                    <p className="text-sm font-medium text-[var(--color-pib-text)]">{deleteError}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">
                      The product stayed in the catalog. Resolve the dependency or archive it before trying again.
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingDeleteProduct(null)
                  setDeleteError(null)
                }}
                className="btn-pib-ghost"
                disabled={deletingId === pendingDeleteProduct.id}
                aria-label={`Cancel delete for catalog product ${productDisplayName(pendingDeleteProduct)}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteProduct}
                className="btn-pib-danger"
                disabled={deletingId === pendingDeleteProduct.id}
                aria-label={`Confirm delete catalog product ${productDisplayName(pendingDeleteProduct)}`}
              >
                <Icon name="delete" />
                {deletingId === pendingDeleteProduct.id ? 'Deleting...' : 'Delete product'}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
