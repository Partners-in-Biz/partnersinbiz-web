'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { Product } from '@/lib/products/types'

export interface ProductPickerProps {
  orgId: string
  onSelect: (product: Product | null) => void
  onAdHoc?: (name: string) => void
  placeholder?: string
  className?: string
}

export function ProductPicker({ onSelect, onAdHoc, placeholder = 'Search products…', className = '' }: ProductPickerProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Fetch product list once on mount
  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/crm/products?limit=200')
      .then(r => r.json())
      .then(body => {
        if (cancelled) return
        if (!body.success) throw new Error(body.error ?? 'Failed to load products')
        setProducts(body.data ?? [])
      })
      .catch(err => {
        if (cancelled) return
        setError(err.message ?? 'Failed to load products')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, []) // intentionally not including _orgId — the API uses session org

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = query.trim()
    ? products.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
    : products

  function selectProduct(product: Product) {
    setQuery(product.name)
    setOpen(false)
    onSelect(product)
  }

  function clear() {
    setQuery('')
    setOpen(false)
    onSelect(null)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && query.trim()) {
      e.preventDefault()
      // If exact match exists, select it; otherwise ad-hoc
      const exact = products.find(p => p.name.toLowerCase() === query.trim().toLowerCase())
      if (exact) {
        selectProduct(exact)
      } else {
        setOpen(false)
        onAdHoc?.(query.trim())
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={loading ? 'Loading products…' : placeholder}
          disabled={loading}
          className="pib-input w-full pr-8 text-sm"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear"
            onClick={clear}
            className="cursor-pointer absolute right-2 text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-400 mt-1">{error}</p>
      )}

      {open && !loading && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 pib-card rounded-lg shadow-lg overflow-hidden max-h-56 overflow-y-auto">
          {filtered.length > 0 ? (
            <ul role="listbox">
              {filtered.map(product => (
                <li key={product.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onClick={() => selectProduct(product)}
                    className="cursor-pointer w-full text-left px-3 py-2 hover:bg-white/[0.05] transition-colors"
                  >
                    <p className="text-sm font-medium text-[var(--color-pib-text)]">{product.name}</p>
                    <p className="text-[11px] text-[var(--color-pib-text-muted)] font-mono">
                      {product.currency} {product.unitPrice.toFixed(2)}
                      {product.unit ? ` / ${product.unit}` : ''}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-3 py-2">
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                {query.trim() ? 'No matching products' : 'No products set up yet'}
              </p>
              {!query.trim() && (
                <Link
                  href="/portal/settings/products"
                  aria-label="Open product catalog to create quote-ready products"
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent-v2)] hover:underline"
                >
                  <span className="material-symbols-outlined text-[14px]">inventory_2</span>
                  Open product catalog
                </Link>
              )}
            </div>
          )}

          {/* Ad-hoc option when query has text and no exact match */}
          {query.trim() && !products.find(p => p.name.toLowerCase() === query.trim().toLowerCase()) && onAdHoc && (
            <button
              type="button"
              onClick={() => { setOpen(false); onAdHoc(query.trim()) }}
              className="cursor-pointer w-full text-left text-xs px-3 py-2 text-[var(--color-accent-v2)] hover:bg-white/[0.05] transition-colors flex items-center gap-1.5 border-t border-[var(--color-pib-line)]"
            >
              <span className="material-symbols-outlined text-[14px]">add</span>
              Add &quot;{query.trim()}&quot; as ad-hoc item
            </button>
          )}
        </div>
      )}
    </div>
  )
}
