'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { Company } from '@/lib/companies/types'
import { CompanyHeader } from '@/components/crm/CompanyHeader'
import { CompanyTabsBar } from '@/components/crm/CompanyTabsBar'
import type { CompanyTab } from '@/components/crm/CompanyTabsBar'
import { CompanyOverviewPanel } from '@/components/crm/CompanyOverviewPanel'
import { CompanyEditDrawer } from '@/components/crm/CompanyEditDrawer'

// ── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-6 w-24" />
      <div className="flex items-start gap-4">
        <Skeleton className="h-16 w-16 rounded-2xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}

// ── Wave-3 placeholder tab ────────────────────────────────────────────────────

function Wave3Placeholder({ label }: { label: string }) {
  return (
    <div className="bento-card p-10 text-center">
      <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">schedule</span>
      <p className="text-sm text-[var(--color-pib-text-muted)] mt-3">
        {label} will appear here once Wave 3 wiring lands.
      </p>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>()

  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tab, setTab] = useState<CompanyTab>('overview')
  const [editOpen, setEditOpen] = useState(false)

  const fetchCompany = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/crm/companies/${id}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const body = await res.json()
      setCompany(body.data ?? body)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load company')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void fetchCompany()
  }, [fetchCompany])

  async function handleSave(patch: Partial<Company>): Promise<void> {
    const res = await fetch(`/api/v1/crm/companies/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'Save failed')
    }
    await fetchCompany()
  }

  // ── Loading / error states ──────────────────────────────────────────────────

  if (loading) return <PageSkeleton />

  if (error || !company) {
    return (
      <div className="bento-card p-10 text-center space-y-4">
        <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">
          {error ? 'error_outline' : 'domain_disabled'}
        </span>
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          {error ?? 'Company not found.'}
        </p>
        <Link href="/portal/companies" className="btn-pib-secondary inline-flex items-center gap-1.5 mt-2">
          <span className="material-symbols-outlined text-sm">arrow_back</span>
          Back to companies
        </Link>
      </div>
    )
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Link
        href="/portal/companies"
        className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] inline-flex items-center gap-1 transition-colors"
      >
        <span className="material-symbols-outlined text-sm">arrow_back</span>
        Companies
      </Link>

      {/* Header */}
      <div className="bento-card p-5">
        <CompanyHeader company={company} onEdit={() => setEditOpen(true)} />
      </div>

      {/* Tabs */}
      <CompanyTabsBar activeTab={tab} onChange={(t) => setTab(t as CompanyTab)} />

      {/* Tab content */}
      <div role="tabpanel">
        {tab === 'overview' && <CompanyOverviewPanel company={company} />}
        {tab === 'contacts' && <Wave3Placeholder label="Linked contacts" />}
        {tab === 'deals' && <Wave3Placeholder label="Linked deals" />}
        {tab === 'quotes' && <Wave3Placeholder label="Linked quotes" />}
        {tab === 'activity' && <Wave3Placeholder label="Activity feed" />}
      </div>

      {/* Edit drawer */}
      {editOpen && (
        <CompanyEditDrawer
          company={company}
          mode="edit"
          onSave={handleSave}
          onClose={() => setEditOpen(false)}
        />
      )}
    </div>
  )
}
