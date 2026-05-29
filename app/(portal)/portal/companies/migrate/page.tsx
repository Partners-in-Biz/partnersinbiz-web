'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { CompanyMigrationCommandCenter } from '@/components/crm/CompanyMigrationCommandCenter'

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

export function ExistingCompanyReviewLink({ companyId, companyName }: { companyId: string; companyName: string }) {
  const label = companyName.trim() || 'matched company'

  return (
    <Link
      href={`/portal/companies/${companyId}`}
      className="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-[var(--color-pib-line)] bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-[var(--color-accent-v2)] transition-colors hover:border-[var(--color-accent-v2)]/50 hover:bg-white/[0.06]"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${label}`}
      title={`Open ${label}`}
    >
      <span className="material-symbols-outlined text-[13px]" aria-hidden="true">open_in_new</span>
      <span className="truncate">Open {label}</span>
    </Link>
  )
}

// ── Result summary banner ─────────────────────────────────────────────────────

function ResultBanner({ summary }: { summary: ApplyResponse['summary'] }) {
  const total = summary.created + summary.linked + summary.failed
  return (
    <div className="bento-card p-5 space-y-3">
      <p className="eyebrow !text-[10px]">Migration complete — {total} group{total === 1 ? '' : 's'} processed</p>
      <div className="flex gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-400" />
          <span className="text-sm text-[var(--color-pib-text)]">
            {summary.created} company{summary.created === 1 ? '' : 'ies'} created
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-400" />
          <span className="text-sm text-[var(--color-pib-text)]">
            {summary.linked} linked to existing
          </span>
        </div>
        {summary.failed > 0 && (
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400" />
            <span className="text-sm text-[var(--color-pib-text)]">
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
      const res = await fetch('/api/v1/crm/companies/migrate-from-contacts', {
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
  }, [])

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

      const res = await fetch('/api/v1/crm/companies/migrate-from-contacts', {
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
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <Link
            href="/portal/companies"
            className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] inline-flex items-center gap-1 transition-colors mb-2"
          >
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            Companies
          </Link>
          <h1 className="text-xl font-semibold text-[var(--color-pib-text)]">Migrate contacts → companies</h1>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-1">
            Review grouped company names from your contacts and create first-class company records.
          </p>
        </div>
        {!applyResult && !loading && !previewError && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--color-pib-text-muted)] font-mono">
              {selectedCount} / {matches.length} selected
            </span>
            <button
              type="button"
              onClick={handleApply}
              disabled={applying || selectedCount === 0}
              className="cursor-pointer btn-pib-accent flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {applying ? (
                <>
                  <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                  Applying…
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  Apply selected
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Apply result */}
      {applyResult && <ResultBanner summary={applyResult.summary} />}

      {/* Apply result detail table */}
      {applyResult && applyResult.results.length > 0 && (
        <div className="pib-card-section overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-pib-line)] bg-white/[0.02]">
                <th className="px-4 py-3 text-left text-[10px] font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]">Group</th>
                <th className="px-4 py-3 text-left text-[10px] font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]">Status</th>
                <th className="px-4 py-3 text-left text-[10px] font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]">Company</th>
                <th className="px-4 py-3 text-left text-[10px] font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]">Contacts updated</th>
                <th className="px-4 py-3 text-left text-[10px] font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-pib-line)]">
              {applyResult.results.map((row) => (
                <tr key={row.normalizedKey} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-[var(--color-pib-text-muted)]">{row.normalizedKey}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full ${
                      row.status === 'created' ? 'bg-green-500/20 text-green-300' :
                      row.status === 'linked'  ? 'bg-blue-500/20 text-blue-300' :
                                                 'bg-red-500/20 text-red-300'
                    }`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-pib-text)]">
                    {row.companyId ? (
                      <Link href={`/portal/companies/${row.companyId}`} className="text-[var(--color-accent-v2)] hover:underline">
                        {row.companyId}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-pib-text-muted)] font-mono text-xs">
                    {row.contactsUpdated ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-pib-text-muted)] text-xs">{row.reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Errors */}
      {previewError && (
        <div className="bento-card p-10 text-center space-y-3">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">
            {previewError.includes('Admin') ? 'lock' : 'error_outline'}
          </span>
          <p className="text-sm text-[var(--color-pib-text-muted)]">{previewError}</p>
        </div>
      )}

      {applyError && (
        <p className="text-sm text-red-400 px-1">{applyError}</p>
      )}

      {/* Loading skeleton */}
      {loading && !previewError && (
        <div className="pib-card-section overflow-x-auto">
          <div className="p-5 space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        </div>
      )}

      {/* Empty state (preview loaded, zero matches) */}
      {!loading && !previewError && !applyResult && matches.length === 0 && (
        <div className="bento-card p-10 text-center space-y-3">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">check_circle</span>
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            No ungrouped company strings found in your contacts. Nothing to migrate.
          </p>
        </div>
      )}

      {/* Preview table */}
      {!loading && !previewError && !applyResult && matches.length > 0 && (
        <div className="space-y-4">
          <CompanyMigrationCommandCenter matches={matches} selected={selected} names={names} />
          <div className="pib-card-section overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-pib-line)] bg-white/[0.02]">
                  <th className="px-4 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all"
                      className="cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]">Normalised key</th>
                  <th className="px-4 py-3 text-left text-[10px] font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]">Raw values</th>
                  <th className="px-4 py-3 text-left text-[10px] font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]">Suggested name</th>
                  <th className="px-4 py-3 text-left text-[10px] font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]">Existing match</th>
                  <th className="px-4 py-3 text-left text-[10px] font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]">Contacts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-pib-line)]">
                {matches.map((m) => (
                  <tr
                    key={m.normalizedKey}
                    className={`transition-colors ${selected[m.normalizedKey] ? '' : 'opacity-50'} hover:bg-white/[0.02]`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={!!selected[m.normalizedKey]}
                        onChange={() => toggleRow(m.normalizedKey)}
                        aria-label={`Select ${m.normalizedKey}`}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--color-pib-text-muted)] max-w-[140px] truncate">
                      {m.normalizedKey}
                    </td>
                    <td className="px-4 py-3 max-w-[180px]">
                      <p className="text-xs text-[var(--color-pib-text-muted)] truncate" title={m.rawValues.join(', ')}>
                        {m.rawValues.join(', ')}
                      </p>
                    </td>
                    <td className="px-4 py-3 min-w-[160px]">
                      <input
                        type="text"
                        value={names[m.normalizedKey] ?? m.suggestedCompanyName}
                        onChange={(e) => setNames((prev) => ({ ...prev, [m.normalizedKey]: e.target.value }))}
                        className="pib-input w-full text-sm py-1"
                        aria-label={`Company name for ${m.normalizedKey}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {m.existingCompanyId ? (
                        <ExistingCompanyReviewLink
                          companyId={m.existingCompanyId}
                          companyName={names[m.normalizedKey] ?? m.suggestedCompanyName}
                        />
                      ) : (
                        <span className="text-xs text-[var(--color-pib-text-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--color-pib-text-muted)]">
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
        <div className="flex items-center justify-between gap-3 pt-2">
          <span className="text-xs text-[var(--color-pib-text-muted)] font-mono">
            {selectedCount} / {matches.length} selected
          </span>
          <button
            type="button"
            onClick={handleApply}
            disabled={applying || selectedCount === 0}
            className="cursor-pointer btn-pib-accent flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {applying ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                Applying…
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                Apply selected
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
