'use client'

import { useState, useMemo } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { TrendChart } from '@/components/seo/TrendChart'
import { SeoToolHeader, type SprintOption } from '@/components/seo/SeoToolHeader'
import { fetchSeo, downloadText } from '@/components/seo/seoToolClient'
import { toCsv } from '@/lib/seo/csv'
import type { SeoKeyword, KeywordPosition, IntentBucket } from '@/lib/seo/types'

type SerializableKeyword = Omit<SeoKeyword, 'createdAt'> & { createdAt: string }

type PositionRange = 'all' | 'top3' | 'top10' | '11-50' | '51-100' | 'not-ranking'

const INTENT_LABELS: Record<IntentBucket, string> = {
  problem: 'Problem',
  solution: 'Solution',
  brand: 'Brand',
}

const STATUS_PILL: Record<string, string> = {
  top_3: 'bg-emerald-700/30 text-emerald-200 border border-emerald-600/30',
  top_10: 'bg-blue-700/30 text-blue-200 border border-blue-600/30',
  ranking: 'bg-amber-700/30 text-amber-200 border border-amber-600/30',
  not_yet: 'bg-zinc-700/30 text-zinc-300 border border-zinc-600/30',
  in_progress: 'bg-violet-700/30 text-violet-200 border border-violet-600/30',
  lost: 'bg-red-700/30 text-red-200 border border-red-600/30',
}

function computeChange(positions: KeywordPosition[]): { current: number | null; previous: number | null; delta: number | null } {
  const sorted = [...positions].sort((a, b) => new Date(a.pulledAt).getTime() - new Date(b.pulledAt).getTime())
  const current = sorted.length >= 1 ? sorted[sorted.length - 1].position : null
  const previous = sorted.length >= 2 ? sorted[sorted.length - 2].position : null
  const delta = current !== null && previous !== null ? previous - current : null
  return { current, previous, delta }
}

function PositionChangePill({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return <span className="text-xs text-[var(--color-pib-text-muted)]">—</span>
  const improved = delta > 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${improved ? 'text-emerald-300' : 'text-red-300'}`}>
      <span className="material-symbols-outlined text-[14px]">{improved ? 'arrow_upward' : 'arrow_downward'}</span>
      {Math.abs(delta).toFixed(1)}
    </span>
  )
}

function filterByRange(pos: number | null | undefined, range: PositionRange): boolean {
  if (range === 'all') return true
  if (range === 'not-ranking') return pos == null
  if (pos == null) return false
  if (range === 'top3') return pos <= 3
  if (range === 'top10') return pos <= 10
  if (range === '11-50') return pos > 10 && pos <= 50
  if (range === '51-100') return pos > 50 && pos <= 100
  return true
}

export function KeywordTrackerClient({
  keywords: initialKeywords,
  sprints,
  activeSprintId,
  activeSprint,
}: {
  keywords: SerializableKeyword[]
  sprints: SprintOption[]
  activeSprintId?: string
  activeSprint: { id: string; gscConnected: boolean } | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Add keyword form state
  const [addKeyword, setAddKeyword] = useState('')
  const [addVolume, setAddVolume] = useState('')
  const [addTargetUrl, setAddTargetUrl] = useState('')
  const [addIntent, setAddIntent] = useState<IntentBucket>('solution')
  const [adding, setAdding] = useState(false)

  // GSC import state
  const [importing, setImporting] = useState(false)

  // Range filter
  const [rangeFilter, setRangeFilter] = useState<PositionRange>('all')

  // Expanded row for inline chart
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Toast
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  function buildScopedHref(path: string) {
    const next = new URLSearchParams(Array.from(searchParams.entries()))
    return `${path}?${next.toString()}`
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!activeSprint || !addKeyword.trim()) return
    setAdding(true)
    try {
      await fetchSeo(`/api/v1/seo/sprints/${activeSprint.id}/keywords`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          keyword: addKeyword.trim(),
          volume: addVolume ? Number(addVolume) : undefined,
          targetPageUrl: addTargetUrl.trim() || undefined,
          intentBucket: addIntent,
        }),
      })
      setAddKeyword('')
      setAddVolume('')
      setAddTargetUrl('')
      setAddIntent('solution')
      showToast('Keyword added')
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add keyword', false)
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(id: string, keyword: string) {
    if (!confirm(`Remove keyword "${keyword}"? This cannot be undone.`)) return
    try {
      await fetchSeo(`/api/v1/seo/keywords/${id}`, { method: 'DELETE' })
      showToast('Keyword removed')
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to remove keyword', false)
    }
  }

  async function handleGscImport() {
    if (!activeSprint) return
    setImporting(true)
    try {
      await fetchSeo(`/api/v1/seo/integrations/gsc/pull/${activeSprint.id}`, { method: 'POST' })
      showToast('Search Console import complete')
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'GSC import failed', false)
    } finally {
      setImporting(false)
    }
  }

  function handleExportCsv() {
    const rows = initialKeywords.map((kw) => {
      const { current, previous, delta } = computeChange(kw.positions ?? [])
      return {
        keyword: kw.keyword,
        currentPosition: current ?? '',
        previousPosition: previous ?? '',
        change: delta ?? '',
        volume: kw.volume ?? '',
        status: kw.status,
        targetPageUrl: kw.targetPageUrl ?? '',
      }
    })
    const csv = toCsv(rows, [
      { key: 'keyword', label: 'Keyword' },
      { key: 'currentPosition', label: 'Current Position' },
      { key: 'previousPosition', label: 'Previous Position' },
      { key: 'change', label: 'Change' },
      { key: 'volume', label: 'Volume' },
      { key: 'status', label: 'Status' },
      { key: 'targetPageUrl', label: 'Target Page' },
    ])
    downloadText(`keywords-${activeSprintId ?? 'export'}.csv`, csv)
  }

  const filteredKeywords = useMemo(
    () => initialKeywords.filter((kw) => filterByRange(kw.currentPosition, rangeFilter)),
    [initialKeywords, rangeFilter],
  )

  const actionSlot = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={handleGscImport}
        disabled={importing || !activeSprint?.gscConnected}
        title={!activeSprint?.gscConnected ? 'Connect Search Console first' : 'Import positions from GSC'}
        className="pib-btn-secondary text-sm disabled:opacity-40"
      >
        <span className={`material-symbols-outlined text-[18px] ${importing ? 'animate-spin' : ''}`}>
          {importing ? 'autorenew' : 'cloud_download'}
        </span>
        {importing ? 'Importing…' : 'Import from Search Console'}
      </button>
      <button onClick={handleExportCsv} disabled={initialKeywords.length === 0} className="pib-btn-secondary text-sm disabled:opacity-40">
        <span className="material-symbols-outlined text-[18px]">download</span>
        CSV
      </button>
    </div>
  )

  return (
    <div className="space-y-6">
      <SeoToolHeader
        eyebrow="Keyword movement"
        title="Keyword Tracker"
        description="Track ranking positions, monitor changes, and import from Search Console."
        sprints={sprints}
        activeSprintId={activeSprintId}
        action={actionSlot}
      />

      {/* Add keyword form */}
      {activeSprint && (
        <section className="pib-card-section">
          <div className="pib-card-section-header">
            <h3 className="text-sm font-semibold">Add keyword</h3>
          </div>
          <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3 p-4">
            <div className="flex flex-col gap-1 min-w-[200px] flex-1">
              <label className="pib-label">Keyword *</label>
              <input
                value={addKeyword}
                onChange={(e) => setAddKeyword(e.target.value)}
                placeholder="e.g. business coaching johannesburg"
                className="pib-input"
                required
              />
            </div>
            <div className="flex flex-col gap-1 w-28">
              <label className="pib-label">Volume</label>
              <input
                type="number"
                value={addVolume}
                onChange={(e) => setAddVolume(e.target.value)}
                placeholder="e.g. 1200"
                className="pib-input"
                min={0}
              />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
              <label className="pib-label">Target page URL</label>
              <input
                type="url"
                value={addTargetUrl}
                onChange={(e) => setAddTargetUrl(e.target.value)}
                placeholder="https://…"
                className="pib-input"
              />
            </div>
            <div className="flex flex-col gap-1 w-36">
              <label className="pib-label">Intent</label>
              <select value={addIntent} onChange={(e) => setAddIntent(e.target.value as IntentBucket)} className="pib-select">
                <option value="problem">Problem</option>
                <option value="solution">Solution</option>
                <option value="brand">Brand</option>
              </select>
            </div>
            <button type="submit" disabled={adding || !addKeyword.trim()} className="pib-btn-primary text-sm self-end disabled:opacity-50">
              <span className="material-symbols-outlined text-[18px]">{adding ? 'hourglass_empty' : 'add'}</span>
              {adding ? 'Adding…' : 'Add keyword'}
            </button>
          </form>
        </section>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow !text-[10px] mr-1">Position filter</span>
        {(['all', 'top3', 'top10', '11-50', '51-100', 'not-ranking'] as PositionRange[]).map((r) => (
          <button
            key={r}
            onClick={() => setRangeFilter(r)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              rangeFilter === r
                ? 'bg-[var(--color-pib-accent)] text-black border-[var(--color-pib-accent)]'
                : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'
            }`}
          >
            {r === 'all' ? 'All' : r === 'top3' ? 'Top 3' : r === 'top10' ? 'Top 10' : r === '11-50' ? '11–50' : r === '51-100' ? '51–100' : 'Not ranking'}
          </button>
        ))}
        {filteredKeywords.length !== initialKeywords.length && (
          <span className="text-xs text-[var(--color-pib-text-muted)] ml-auto">
            Showing {filteredKeywords.length} of {initialKeywords.length}
          </span>
        )}
      </div>

      {/* Table */}
      {initialKeywords.length === 0 ? (
        <div className="pib-card p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">key_off</span>
          <h3 className="font-headline text-lg font-semibold mt-3">No keywords tracked yet</h3>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-1.5 max-w-md mx-auto">
            Add keywords above or import them from Search Console to start tracking positions.
          </p>
        </div>
      ) : (
        <div className="pib-card-section overflow-hidden">
          <div className="hidden md:grid grid-cols-12 gap-2 px-5 py-3 border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)]">
            <p className="col-span-4 eyebrow !text-[10px]">Keyword</p>
            <p className="col-span-1 eyebrow !text-[10px] text-right">Position</p>
            <p className="col-span-1 eyebrow !text-[10px] text-right">Change</p>
            <p className="col-span-2 eyebrow !text-[10px] text-right">Volume</p>
            <p className="col-span-2 eyebrow !text-[10px]">Status</p>
            <p className="col-span-2 eyebrow !text-[10px] text-right">Actions</p>
          </div>

          {filteredKeywords.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--color-pib-text-muted)]">No keywords match the selected filter.</div>
          ) : (
            <div className="divide-y divide-[var(--color-pib-line)]">
              {filteredKeywords.map((kw) => {
                const { current, previous, delta } = computeChange(kw.positions ?? [])
                const isExpanded = expandedId === kw.id
                const positions = kw.positions ?? []
                const chartLabels = positions.map((p) => p.pulledAt.slice(5, 10))
                const chartPoints = positions.map((p) => p.position)

                return (
                  <div key={kw.id}>
                    <div
                      className="grid grid-cols-2 md:grid-cols-12 gap-2 px-5 py-4 hover:bg-[var(--color-pib-surface-2)] transition-colors cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : kw.id)}
                    >
                      <div className="col-span-2 md:col-span-4">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[14px] text-[var(--color-pib-text-muted)]">
                            {isExpanded ? 'expand_less' : 'expand_more'}
                          </span>
                          <div>
                            <p className="font-semibold text-sm">{kw.keyword}</p>
                            {kw.targetPageUrl && (
                              <p className="text-[11px] text-[var(--color-pib-text-muted)] truncate max-w-xs">
                                {kw.targetPageUrl.replace(/^https?:\/\//, '')}
                              </p>
                            )}
                            <span className="text-[10px] text-[var(--color-pib-text-muted)]">{INTENT_LABELS[kw.intentBucket]}</span>
                          </div>
                        </div>
                      </div>

                      <div className="md:col-span-1 text-right tabular-nums text-sm">
                        <p className="md:hidden eyebrow !text-[9px] mb-1">Position</p>
                        {current != null ? `#${current.toFixed(1)}` : '—'}
                        {previous != null && (
                          <p className="text-[10px] text-[var(--color-pib-text-muted)]">was #{previous.toFixed(1)}</p>
                        )}
                      </div>

                      <div className="md:col-span-1 text-right">
                        <p className="md:hidden eyebrow !text-[9px] mb-1">Change</p>
                        <PositionChangePill delta={delta} />
                      </div>

                      <div className="md:col-span-2 text-right tabular-nums text-sm">
                        <p className="md:hidden eyebrow !text-[9px] mb-1">Volume</p>
                        {kw.volume != null ? kw.volume.toLocaleString('en-ZA') : '—'}
                      </div>

                      <div className="md:col-span-2">
                        <p className="md:hidden eyebrow !text-[9px] mb-1">Status</p>
                        <span className={`text-[10px] px-2 py-1 rounded uppercase tracking-wide ${STATUS_PILL[kw.status] ?? STATUS_PILL.not_yet}`}>
                          {kw.status.replace(/_/g, ' ')}
                        </span>
                      </div>

                      <div className="md:col-span-2 flex justify-end items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleRemove(kw.id, kw.keyword)}
                          className="p-1.5 rounded-lg hover:bg-red-900/30 text-[var(--color-pib-text-muted)] hover:text-red-300 transition-colors"
                          title="Remove keyword"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                      </div>
                    </div>

                    {/* Expanded row: inline history chart */}
                    {isExpanded && (
                      <div className="px-5 pb-5 pt-2 bg-[var(--color-pib-surface-2)] border-t border-[var(--color-pib-line)]">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-semibold text-[var(--color-pib-text-muted)]">Position history — {kw.keyword}</p>
                          <a
                            href={buildScopedHref(`/portal/seo/keywords/${kw.id}`)}
                            className="text-xs text-[var(--color-pib-accent)] hover:underline flex items-center gap-1"
                          >
                            Full history
                            <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
                          </a>
                        </div>
                        {chartLabels.length < 2 ? (
                          <p className="text-xs text-[var(--color-pib-text-muted)]">Not enough position history yet.</p>
                        ) : (
                          <TrendChart
                            labels={chartLabels}
                            series={[{ label: 'Position', points: chartPoints }]}
                            height={160}
                            reverseY={true}
                            zeroBased={false}
                            yFormat={(v) => `#${v.toFixed(0)}`}
                          />
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 rounded-2xl border px-4 py-3 text-sm shadow-2xl ${
            toast.ok
              ? 'border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]'
              : 'border-red-600/40 bg-red-950/80 text-red-200'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
