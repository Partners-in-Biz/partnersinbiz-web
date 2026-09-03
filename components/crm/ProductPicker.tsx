'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { Product } from '@/lib/products/types'
import { scopedApiPath, scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import { Icon } from '@/components/studio'

export interface ProductPickerProps {
  orgId: string
  orgScope?: PortalOrgRouteScope
  onSelect: (product: Product | null) => void
  onAdHoc?: (name: string) => void
  placeholder?: string
  className?: string
}

function productDisplayName(product: Product) {
  return product.name?.trim() || 'Product name missing'
}

export function ProductPicker({ orgId, orgScope, onSelect, onAdHoc, placeholder = 'Search products…', className = '' }: ProductPickerProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const productScope = orgScope ?? { orgId }
  const productsEndpoint = scopedApiPath('/api/v1/crm/products?limit=200', productScope)
  const productCatalogHref = scopedPortalPath('/portal/settings/products', productScope)

  // Fetch product list once on mount
  useEffect(() => {
    let cancelled = false
    fetch(productsEndpoint)
      .then(r => r.json())
      .then(body => {
        if (cancelled) return
        if (!body.success) throw new Error(body.error ?? 'Failed to load products')
        setProducts(body.data?.products ?? body.data ?? [])
      })
      .catch(err => {
        if (cancelled) return
        setError(err.message ?? 'Failed to load products')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [productsEndpoint])

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
    ? products.filter(p => productDisplayName(p).toLowerCase().includes(query.toLowerCase()))
    : products

  function selectProduct(product: Product) {
    const displayName = productDisplayName(product)
    setQuery(displayName)
    setOpen(false)
    onSelect({ ...product, name: displayName })
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
      const exact = products.find(p => productDisplayName(p).toLowerCase() === query.trim().toLowerCase())
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
          aria-label="Search products"
          disabled={loading}
          className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 pr-8 text-xs text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] focus:border-[var(--color-accent-v2)] focus:outline-none"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear"
            onClick={clear}
            className="cursor-pointer absolute right-2 text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
          >
            <Icon name="close" className="text-[16px]" />
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs text-[var(--st-danger)] mt-1">{error}</p>
      )}

      {open && !loading && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] overflow-hidden max-h-56 overflow-y-auto">
          {filtered.length > 0 ? (
            <ul role="listbox">
              {filtered.map(product => {
                const displayName = productDisplayName(product)

                return (
                <li key={product.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onClick={() => selectProduct(product)}
                    aria-label={`Select product ${displayName}`}
                    className="cursor-pointer w-full text-left px-2.5 py-1.5 hover:bg-white/[0.05] transition-colors"
                  >
                    <p className="text-xs font-medium text-[var(--color-pib-text)]">{displayName}</p>
                    <p className="text-[11px] text-[var(--color-pib-text-muted)] font-mono">
                      {product.currency} {product.unitPrice.toFixed(2)}
                      {product.unit ? ` / ${product.unit}` : ''}
                    </p>
                  </button>
                </li>
                )
              })}
            </ul>
          ) : (
            <div className="px-2.5 py-2">
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                {query.trim() ? 'No matching products' : 'No products set up yet'}
              </p>
              {!query.trim() && (
                <Link
                  href={productCatalogHref}
                  aria-label="Open product catalog to create quote-ready products"
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent-v2)] hover:underline"
                >
                  <Icon name="inventory_2" className="text-[14px]" />
                  Open product catalog
                </Link>
              )}
            </div>
          )}

          {/* Ad-hoc option when query has text and no exact match */}
          {query.trim() && !products.find(p => productDisplayName(p).toLowerCase() === query.trim().toLowerCase()) && onAdHoc && (
            <button
              type="button"
              onClick={() => { setOpen(false); onAdHoc(query.trim()) }}
              className="cursor-pointer w-full text-left text-xs px-2.5 py-1.5 text-[var(--color-accent-v2)] hover:bg-white/[0.05] transition-colors flex items-center gap-1.5 border-t border-[var(--color-card-border)]"
            >
              <Icon name="add" className="text-[14px]" />
              Add &quot;{query.trim()}&quot; as ad-hoc item
            </button>
          )}
        </div>
      )}
    </div>
  )
}
