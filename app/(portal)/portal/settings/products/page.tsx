'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { ProductModal } from '@/components/crm/ProductModal'
import type { Product } from '@/lib/products/types'

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ── Fetch ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true)
    setFetchError(null)
    fetch('/api/v1/crm/products')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((body) => {
        const list: Product[] = body.data?.products ?? body.data ?? body ?? []
        setProducts(Array.isArray(list) ? list : [])
      })
      .catch(() => setFetchError('Failed to load products. Please try again.'))
      .finally(() => setLoading(false))
  }, [])

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
    if (!window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return
    setDeletingId(p.id)
    try {
      const res = await fetch(`/api/v1/crm/products/${p.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setProducts((prev) => prev.filter((x) => x.id !== p.id))
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed.')
    } finally {
      setDeletingId(null)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-lg font-semibold mb-1">Product Catalog</h1>
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            Manage your workspace&apos;s products and services.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenCreate}
          className="cursor-pointer btn-pib-accent flex items-center gap-1.5 text-sm shrink-0"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          New product
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-pib-text-muted)]">Loading…</p>
      ) : fetchError ? (
        <div className="px-4 py-3 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-sm text-[var(--color-pib-text-muted)]">
          {fetchError}
        </div>
      ) : products.length === 0 ? (
        <div className="bento-card !p-8 text-center">
          <span className="material-symbols-outlined text-[32px] text-[var(--color-pib-text-muted)] mb-3 block">inventory_2</span>
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            No products yet. Add your first product.
          </p>
          <button
            type="button"
            onClick={handleOpenCreate}
            className="cursor-pointer btn-pib-accent flex items-center gap-1.5 text-sm mx-auto mt-4"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            New product
          </button>
        </div>
      ) : (
        <div className="bento-card !p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-pib-line)]">
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wider">Unit</th>
                <th className="text-right px-4 py-3 text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wider">Unit Price</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wider">Currency</th>
                <th className="text-right px-4 py-3 text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, i) => (
                <tr
                  key={p.id}
                  className={[
                    'transition-colors hover:bg-white/[0.02]',
                    i < products.length - 1 ? 'border-b border-[var(--color-pib-line)]' : '',
                  ].join(' ')}
                >
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-[var(--color-pib-text-muted)]">{p.unit ?? '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{p.unitPrice.toFixed(2)}</td>
                  <td className="px-4 py-3 text-[var(--color-pib-text-muted)]">{p.currency}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(p)}
                        title="Edit product"
                        className="cursor-pointer w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.06] transition-colors"
                      >
                        <span className="material-symbols-outlined text-[16px]">edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(p)}
                        disabled={deletingId === p.id}
                        title="Delete product"
                        className="cursor-pointer w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:text-red-400 hover:bg-red-400/[0.08] transition-colors disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[16px]">{deletingId === p.id ? 'hourglass_empty' : 'delete'}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
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
    </div>
  )
}
