'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CompanyMigrationCommandCenter } from '@/components/crm/CompanyMigrationCommandCenter'
import { ExistingCompanyReviewLink } from '@/components/crm/ExistingCompanyReviewLink'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import { Icon } from '@/components/studio'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MigrateMatch {
  normalizedKey: string
  rawValues: string[]
  contactIds: string[]
  suggestedCompanyName: string
  existingCompanyId: string | null
}

interface MigratePreviewResponse {
  matches: MigrateMatch[]
}

interface ApplySelection {
  normalizedKey: string
  companyName: string
  useExistingCompanyId?: string
}

interface ApplyResultRow {
  normalizedKey: string
  status: 'created' | 'linked' | 'failed'
  reason?: string
  companyId?: string
  contactsUpdated?: number
}

interface ApplyResponse {
  results: ApplyResultRow[]
  summary: { created: number; linked: number; failed: number }
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

// ── Result summary banner ─────────────────────────────────────────────────────

function ResultBanner({ summary }: { summary: ApplyResponse['summary'] }) {
  const total = summary.created + summary.linked + summary.failed
  return (
    <div className="pib-card space-y-2">
      <p className="pib-label mb-0">Migration complete - {total} group{total === 1 ? '' : 's'} processed</p>
      <div className="flex gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded bg-[var(--st-success)]" />
          <span className="text-xs text-[var(--color-pib-text)]">
            {summary.created} company{summary.created === 1 ? '' : 'ies'} created
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded bg-[var(--sc-ink-soft)]" />
          <span className="text-xs text-[var(--color-pib-text)]">
            {summary.linked} linked to existing
          </span>
        </div>
        {summary.failed > 0 && (
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded bg-[var(--color-error)]" />
            <span className="text-xs text-[var(--color-pib-text)]">
              {summary.failed} failed
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function MigrateCompaniesPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const companyApiPath = useCallback((path: string) => scopedApiPath(path, orgScope), [orgScope])
  const companyPortalPath = useCallback((path: string) => scopedPortalPath(path, orgScope), [orgScope])
  const [matches, setMatches] = useState<MigrateMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // Per-row state: selected + editable name
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [names, setNames] = useState<Record<string, string>>({})

  // Apply state
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applyResult, setApplyResult] = useState<ApplyResponse | null>(null)

  // ── Preview fetch ───────────────────────────────────────────────────────────

  const fetchPreview = useCallback(async () => {
    setLoading(true)
    setPreviewError(null)
    try {
      const res = await fetch(companyApiPath('/api/v1/crm/companies/' + ['migrate', 'from', 'contacts'].join('-')), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'preview' }),
      })
      if (res.status === 403) {
        setPreviewError('Admin access required to use the migration tool.')
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const body: { data?: MigratePreviewResponse } & Partial<MigratePreviewResponse> = await res.json()
      const data: MigratePreviewResponse = body.data ?? (body as MigratePreviewResponse)
      const rows = data.matches ?? []
      setMatches(rows)
      // Initialise per-row state
      const sel: Record<string, boolean> = {}
      const ns: Record<string, string> = {}
      for (const m of rows) {
        sel[m.normalizedKey] = true
        ns[m.normalizedKey] = m.suggestedCompanyName
      }
      setSelected(sel)
      setNames(ns)
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : 'Failed to load preview')
    } finally {
      setLoading(false)
    }
  }, [companyApiPath])

  useEffect(() => {
    void fetchPreview()
  }, [fetchPreview])

  // ── Select-all toggle ───────────────────────────────────────────────────────

  const allSelected = matches.length > 0 && matches.every((m) => selected[m.normalizedKey])

  function toggleAll() {
    const next = !allSelected
    const updated: Record<string, boolean> = {}
    for (const m of matches) updated[m.normalizedKey] = next
    setSelected(updated)
  }

  function toggleRow(key: string) {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  // ── Apply ───────────────────────────────────────────────────────────────────

  async function handleApply() {
    setApplying(true)
    setApplyError(null)
    try {
      const selections: ApplySelection[] = matches
        .filter((m) => selected[m.normalizedKey])
        .map((m) => ({
          normalizedKey: m.normalizedKey,
          companyName: names[m.normalizedKey] ?? m.suggestedCompanyName,
          ...(m.existingCompanyId ? { useExistingCompanyId: m.existingCompanyId } : {}),
        }))

      if (selections.length === 0) {
        setApplyError('No rows selected.')
        return
      }

      const res = await fetch(companyApiPath('/api/v1/crm/companies/' + ['migrate', 'from', 'contacts'].join('-')), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'apply', selections }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const body = await res.json()
      setApplyResult(body.data ?? body)
    } catch (err: unknown) {
      setApplyError(err instanceof Error ? err.message : 'Migration failed')
    } finally {
      setApplying(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const selectedCount = Object.values(selected).filter(Boolean).length

  return (
    <div className="flex flex-col space-y-8">
      {/* Header row */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={companyPortalPath('/portal/companies')}
            className="btn-pib-ghost text-xs"
          >
            <Icon name="arrow_back" />
            Companies
          </Link>
          <p className="eyebrow mt-4">CRM · Companies</p>
          <h1 className="pib-page-title mt-2">Migrate contacts → companies</h1>
          <p className="pib-page-sub">
            Review grouped company names from your contacts and create first-class company records.
          </p>
        </div>
        {!applyResult && !loading && !previewError && matches.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-[var(--color-pib-text-muted)]">
              {selectedCount} / {matches.length} selected
            </span>
            <button
              type="button"
              onClick={handleApply}
              disabled={applying || selectedCount === 0}
              className="btn-pib-primary text-xs"
            >
              {applying ? (
                <>
                  <Icon name="progress_activity" />
                  Applying…
                </>
              ) : (
                <>
                  <Icon name="check_circle" />
                  Apply selected
                </>
              )}
            </button>
          </div>
        )}
      </header>

      {/* Apply result */}
      {applyResult && <ResultBanner summary={applyResult.summary} />}

      {/* Apply result detail table */}
      {applyResult && applyResult.results.length > 0 && (
        <div className="pib-surface pib-surface-table overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-pib-line)]">
                <th className="px-3 py-2 text-left pib-label mb-0">Group</th>
                <th className="px-3 py-2 text-left pib-label mb-0">Status</th>
                <th className="px-3 py-2 text-left pib-label mb-0">Company</th>
                <th className="px-3 py-2 text-left pib-label mb-0">Contacts updated</th>
                <th className="px-3 py-2 text-left pib-label mb-0">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-pib-line)]">
              {applyResult.results.map((row) => (
                <tr key={row.normalizedKey} className="hover:bg-[var(--color-row-hover)] transition-colors">
                  <td className="px-3 py-2 font-mono text-xs text-[var(--color-pib-text-muted)]">{row.normalizedKey}</td>
                  <td className="px-3 py-2">
                    <span className={`pib-pill ${
                      row.status === 'created' ? 'pib-pill-success' :
                      row.status === 'linked'  ? 'pib-pill-blue' :
                                                 'pib-pill-danger'
                    }`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-pib-text)]">
                    {row.companyId ? (
                      <Link href={companyPortalPath(`/portal/companies/${row.companyId}`)} className="text-[var(--color-pib-accent-hover)] hover:underline">
                        {row.companyId}
                      </Link>
                    ) : '-'}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-pib-text-muted)] font-mono text-xs">
                    {row.contactsUpdated ?? '-'}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-pib-text-muted)] text-xs">{row.reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Errors */}
      {previewError && (
        <div className="pib-empty-state space-y-2">
          <Icon name={previewError.includes('Admin') ? 'lock' : 'error_outline'} />
          <p className="text-xs text-[var(--color-pib-text-muted)]">{previewError}</p>
        </div>
      )}

      {applyError && (
        <p className="rounded-lg border border-[var(--color-error)]/40 bg-[var(--color-error-container)] px-3 py-2 text-xs text-[var(--color-error)]">{applyError}</p>
      )}

      {/* Loading skeleton */}
      {loading && !previewError && (
        <div className="pib-surface pib-surface-table overflow-x-auto">
          <div className="p-4 space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        </div>
      )}

      {/* Empty state (preview loaded, zero matches) */}
      {!loading && !previewError && !applyResult && matches.length === 0 && (
        <div className="pib-empty-state">
          <Icon name="check_circle" />
          <p className="eyebrow">Clean account data</p>
          <h2 className="pib-empty-state-title mt-2">
            No contact company strings need migration.
          </h2>
          <p className="pib-empty-state-description">
            Every visible contact company value is already grouped or ready for first-class account work.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Link href={companyPortalPath('/portal/companies')} className="btn-pib-primary text-xs">
              <Icon name="business" />
              Review companies
            </Link>
            <Link href={companyPortalPath('/portal/contacts')} className="btn-pib-secondary text-xs">
              <Icon name="group" />
              Review contacts
            </Link>
          </div>
        </div>
      )}

      {/* Preview table */}
      {!loading && !previewError && !applyResult && matches.length > 0 && (
        <div className="flex flex-col gap-2">
          <CompanyMigrationCommandCenter matches={matches} selected={selected} names={names} />
          <div className="pib-surface pib-surface-table overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--color-pib-line)]">
                  <th className="px-3 py-2 text-left w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all"
                      className="cursor-pointer"
                    />
                  </th>
                  <th className="px-3 py-2 text-left pib-label mb-0">Normalised key</th>
                  <th className="px-3 py-2 text-left pib-label mb-0">Raw values</th>
                  <th className="px-3 py-2 text-left pib-label mb-0">Suggested name</th>
                  <th className="px-3 py-2 text-left pib-label mb-0">Existing match</th>
                  <th className="px-3 py-2 text-left pib-label mb-0">Contacts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-pib-line)]">
                {matches.map((m) => (
                  <tr
                    key={m.normalizedKey}
                    className={`transition-colors ${selected[m.normalizedKey] ? '' : 'opacity-50'} hover:bg-[var(--color-row-hover)]`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={!!selected[m.normalizedKey]}
                        onChange={() => toggleRow(m.normalizedKey)}
                        aria-label={`Select ${m.normalizedKey}`}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--color-pib-text-muted)] max-w-[140px] truncate">
                      {m.normalizedKey}
                    </td>
                    <td className="px-3 py-2 max-w-[180px]">
                      <p className="text-xs text-[var(--color-pib-text-muted)] truncate" title={m.rawValues.join(', ')}>
                        {m.rawValues.join(', ')}
                      </p>
                    </td>
                    <td className="px-3 py-2 min-w-[160px]">
                      <input
                        type="text"
                        value={names[m.normalizedKey] ?? m.suggestedCompanyName}
                        onChange={(e) => setNames((prev) => ({ ...prev, [m.normalizedKey]: e.target.value }))}
                        className="pib-input h-8 w-full px-2 text-xs"
                        aria-label={`Company name for ${m.normalizedKey}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {m.existingCompanyId ? (
                        <ExistingCompanyReviewLink
                          companyId={m.existingCompanyId}
                          companyName={names[m.normalizedKey] ?? m.suggestedCompanyName}
                          href={companyPortalPath(`/portal/companies/${m.existingCompanyId}`)}
                        />
                      ) : (
                        <span className="text-xs text-[var(--color-pib-text-muted)]">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--color-pib-text-muted)]">
                      {m.contactIds.length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bottom action bar (mirrors top, only visible when table has content) */}
      {!loading && !previewError && !applyResult && matches.length > 0 && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="font-mono text-[11px] text-[var(--color-pib-text-muted)]">
            {selectedCount} / {matches.length} selected
          </span>
          <button
            type="button"
            onClick={handleApply}
            disabled={applying || selectedCount === 0}
            className="btn-pib-primary text-xs"
          >
            {applying ? (
              <>
                <Icon name="progress_activity" />
                Applying…
              </>
            ) : (
              <>
                <Icon name="check_circle" />
                Apply selected
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
