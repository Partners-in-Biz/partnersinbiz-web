'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CompanyMigrationCommandCenter } from '@/components/crm/CompanyMigrationCommandCenter'
import { ExistingCompanyReviewLink } from '@/components/crm/ExistingCompanyReviewLink'
import { scopedApiPath, scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

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
    <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-3 space-y-2">
      <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Migration complete — {total} group{total === 1 ? '' : 's'} processed</p>
      <div className="flex gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
          <span className="text-xs text-on-surface">
            {summary.created} company{summary.created === 1 ? '' : 'ies'} created
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-400" />
          <span className="text-xs text-on-surface">
            {summary.linked} linked to existing
          </span>
        </div>
        {summary.failed > 0 && (
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-red-400" />
            <span className="text-xs text-on-surface">
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
      const res = await fetch(companyApiPath('/api/v1/crm/companies/migrate-from-contacts'), {
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

      const res = await fetch(companyApiPath('/api/v1/crm/companies/migrate-from-contacts'), {
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
    <div className="flex flex-col gap-2">
      {/* Header row */}
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/55 px-3 py-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link
            href={companyPortalPath('/portal/companies')}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-on-surface-variant transition-colors hover:bg-white/[0.05] hover:text-on-surface"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">arrow_back</span>
            Companies
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-on-surface">Migrate contacts → companies</h1>
            <p className="truncate text-xs text-on-surface-variant">
              Review grouped company names from your contacts and create first-class company records.
            </p>
          </div>
        </div>
        {!applyResult && !loading && !previewError && matches.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-on-surface-variant">
              {selectedCount} / {matches.length} selected
            </span>
            <button
              type="button"
              onClick={handleApply}
              disabled={applying || selectedCount === 0}
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
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
        <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/45 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-card-border)]">
                <th className="px-3 py-2 text-left text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Group</th>
                <th className="px-3 py-2 text-left text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Status</th>
                <th className="px-3 py-2 text-left text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Company</th>
                <th className="px-3 py-2 text-left text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Contacts updated</th>
                <th className="px-3 py-2 text-left text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-card-border)]">
              {applyResult.results.map((row) => (
                <tr key={row.normalizedKey} className="hover:bg-white/[0.04] transition-colors">
                  <td className="px-3 py-2 font-mono text-xs text-on-surface-variant">{row.normalizedKey}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full ${
                      row.status === 'created' ? 'bg-green-500/20 text-green-300' :
                      row.status === 'linked'  ? 'bg-blue-500/20 text-blue-300' :
                                                 'bg-red-500/20 text-red-300'
                    }`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-on-surface">
                    {row.companyId ? (
                      <Link href={companyPortalPath(`/portal/companies/${row.companyId}`)} className="text-primary hover:underline">
                        {row.companyId}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-on-surface-variant font-mono text-xs">
                    {row.contactsUpdated ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-on-surface-variant text-xs">{row.reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Errors */}
      {previewError && (
        <div className="space-y-2 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-4 text-center">
          <span className="material-symbols-outlined text-[19px] text-on-surface-variant">
            {previewError.includes('Admin') ? 'lock' : 'error_outline'}
          </span>
          <p className="text-xs text-on-surface-variant">{previewError}</p>
        </div>
      )}

      {applyError && (
        <p className="rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-100">{applyError}</p>
      )}

      {/* Loading skeleton */}
      {loading && !previewError && (
        <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/45 overflow-x-auto">
          <div className="p-3 space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        </div>
      )}

      {/* Empty state (preview loaded, zero matches) */}
      {!loading && !previewError && !applyResult && matches.length === 0 && (
        <div className="space-y-2 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-4 text-center">
          <span className="material-symbols-outlined mx-auto grid h-8 w-8 place-items-center rounded-md bg-primary/10 text-[19px] text-primary" aria-hidden="true">check_circle</span>
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Clean account data</p>
          <h2 className="text-sm font-semibold text-on-surface">
            No contact company strings need migration.
          </h2>
          <p className="mx-auto max-w-2xl text-xs leading-5 text-on-surface-variant">
            Every visible contact company value is already grouped or ready for first-class account work.
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
            <Link href={companyPortalPath('/portal/companies')} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition hover:opacity-90">
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">business</span>
              Review companies
            </Link>
            <Link href={companyPortalPath('/portal/contacts')} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-3 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface">
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">group</span>
              Review contacts
            </Link>
          </div>
        </div>
      )}

      {/* Preview table */}
      {!loading && !previewError && !applyResult && matches.length > 0 && (
        <div className="flex flex-col gap-2">
          <CompanyMigrationCommandCenter matches={matches} selected={selected} names={names} />
          <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)]/45 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--color-card-border)]">
                  <th className="px-3 py-2 text-left w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all"
                      className="cursor-pointer"
                    />
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Normalised key</th>
                  <th className="px-3 py-2 text-left text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Raw values</th>
                  <th className="px-3 py-2 text-left text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Suggested name</th>
                  <th className="px-3 py-2 text-left text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Existing match</th>
                  <th className="px-3 py-2 text-left text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">Contacts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-card-border)]">
                {matches.map((m) => (
                  <tr
                    key={m.normalizedKey}
                    className={`transition-colors ${selected[m.normalizedKey] ? '' : 'opacity-50'} hover:bg-white/[0.04]`}
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
                    <td className="px-3 py-2 font-mono text-xs text-on-surface-variant max-w-[140px] truncate">
                      {m.normalizedKey}
                    </td>
                    <td className="px-3 py-2 max-w-[180px]">
                      <p className="text-xs text-on-surface-variant truncate" title={m.rawValues.join(', ')}>
                        {m.rawValues.join(', ')}
                      </p>
                    </td>
                    <td className="px-3 py-2 min-w-[160px]">
                      <input
                        type="text"
                        value={names[m.normalizedKey] ?? m.suggestedCompanyName}
                        onChange={(e) => setNames((prev) => ({ ...prev, [m.normalizedKey]: e.target.value }))}
                        className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-on-surface focus:outline-none"
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
                        <span className="text-xs text-on-surface-variant">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-on-surface-variant">
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
          <span className="font-mono text-[11px] text-on-surface-variant">
            {selectedCount} / {matches.length} selected
          </span>
          <button
            type="button"
            onClick={handleApply}
            disabled={applying || selectedCount === 0}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
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
