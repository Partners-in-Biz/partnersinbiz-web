'use client'
// components/ads/google/KeywordEditor.tsx
// Per-ad-group keyword list with inline add / remove.
// Sub-3a Phase 2 Batch 4.

import { useEffect, useState } from 'react'
import type { AdKeyword } from '@/lib/ads/types'
import type { AdKeywordMatchType } from '@/lib/ads/providers/google/mappers'

interface Props {
  orgId: string
  adSetId: string
  campaignId: string
}

interface NewKwForm {
  text: string
  matchType: AdKeywordMatchType
  negativeKeyword: boolean
  cpcBidMajor: string // user types major; we convert to micros string on submit
}

const MATCH_COLORS: Record<AdKeywordMatchType | 'NEGATIVE', string> = {
  EXACT: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  PHRASE: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  BROAD: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  NEGATIVE: 'bg-red-500/15 text-red-300 border-red-500/30',
}

function matchPillClass(kw: AdKeyword): string {
  if (kw.negativeKeyword) return MATCH_COLORS.NEGATIVE
  return MATCH_COLORS[kw.matchType] ?? MATCH_COLORS.BROAD
}

function majorToMicros(major: string): string | undefined {
  const n = parseFloat(major)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.round(n * 1_000_000).toString()
}

function microsToMajor(micros: string | undefined): string {
  if (!micros) return ''
  const n = parseInt(micros, 10)
  if (!Number.isFinite(n)) return ''
  return (n / 1_000_000).toFixed(2)
}

const DEFAULT_FORM: NewKwForm = {
  text: '',
  matchType: 'BROAD',
  negativeKeyword: false,
  cpcBidMajor: '',
}

export function KeywordEditor({ orgId, adSetId, campaignId }: Props) {
  const [keywords, setKeywords] = useState<AdKeyword[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<NewKwForm>(DEFAULT_FORM)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    setRemoveError(null)
    try {
      const res = await fetch(
        `/api/v1/ads/keywords?adSetId=${encodeURIComponent(adSetId)}`,
        { headers: { 'X-Org-Id': orgId } },
      )
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      setKeywords((body.data?.keywords ?? []) as AdKeyword[])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adSetId])

  async function handleAdd() {
    if (!form.text.trim()) return
    setAdding(true)
    setAddError(null)
    setRemoveError(null)
    try {
      const payload: Record<string, unknown> = {
        campaignId,
        adSetId,
        text: form.text.trim(),
        matchType: form.matchType,
        negativeKeyword: form.negativeKeyword,
      }
      const micros = majorToMicros(form.cpcBidMajor)
      if (micros) payload.cpcBidMicros = micros

      const res = await fetch('/api/v1/ads/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      setForm(DEFAULT_FORM)
      await load()
    } catch (err) {
      setAddError((err as Error).message)
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id)
    setRemoveError(null)
    try {
      const res = await fetch(`/api/v1/ads/keywords/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'X-Org-Id': orgId },
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      await load()
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : 'Keyword removal failed')
    } finally {
      setRemovingId(null)
    }
  }

  const inputCls =
    'rounded border border-white/10 bg-white/5 px-3 py-1.5 text-sm focus:outline-none focus:border-[#F5A623]/60'
  const selectCls =
    'rounded border border-white/10 bg-[#0a0a0a] px-3 py-1.5 text-sm focus:outline-none focus:border-[#F5A623]/60'

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-white/40">Keywords</h2>

      {/* List */}
      {loading && (
        <p className="text-xs text-white/40">Loading keywords…</p>
      )}
      {error && (
        <p className="text-xs text-red-300">Failed to load: {error}</p>
      )}
      {!loading && !error && keywords.length === 0 && (
        <p className="text-xs text-white/40">No keywords yet. Add one below.</p>
      )}
      {!loading && keywords.length > 0 && (
        <div className="rounded border border-white/10 divide-y divide-white/5">
          {keywords.map((kw) => (
            <div
              key={kw.id}
              className="flex items-center justify-between px-4 py-2.5 text-sm"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-medium truncate">{kw.text}</span>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${matchPillClass(kw)}`}
                >
                  {kw.negativeKeyword ? 'NEG' : kw.matchType}
                </span>
              </div>
              <div className="flex items-center gap-4 ml-4 shrink-0">
                {kw.cpcBidMicros && (
                  <span className="text-xs text-white/40">
                    CPC ${microsToMajor(kw.cpcBidMicros)}
                  </span>
                )}
                <button
                  type="button"
                  className="text-xs text-white/30 hover:text-red-400 disabled:opacity-40"
                  onClick={() => handleRemove(kw.id)}
                  disabled={removingId === kw.id}
                  aria-label={`Remove keyword ${kw.text}`}
                >
                  {removingId === kw.id ? '…' : 'Remove'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {removeError && (
        <p role="alert" className="text-xs text-red-300">
          {removeError}
        </p>
      )}

      {/* Add row */}
      <div className="rounded border border-white/10 bg-white/[0.02] p-4 space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-white/40">Add keyword</h3>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            className={`${inputCls} flex-1 min-w-[180px]`}
            value={form.text}
            onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
            placeholder="Keyword text"
            maxLength={80}
            aria-label="Keyword text"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleAdd()
            }}
          />
          <select
            className={selectCls}
            value={form.matchType}
            onChange={(e) =>
              setForm((f) => ({ ...f, matchType: e.target.value as AdKeywordMatchType }))
            }
            aria-label="Match type"
          >
            <option value="BROAD">Broad</option>
            <option value="PHRASE">Phrase</option>
            <option value="EXACT">Exact</option>
          </select>
          <input
            type="number"
            className={`${inputCls} w-28`}
            value={form.cpcBidMajor}
            onChange={(e) => setForm((f) => ({ ...f, cpcBidMajor: e.target.value }))}
            placeholder="CPC bid $"
            min="0"
            step="0.01"
            aria-label="CPC bid"
          />
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.negativeKeyword}
              onChange={(e) =>
                setForm((f) => ({ ...f, negativeKeyword: e.target.checked }))
              }
              aria-label="Negative keyword"
            />
            <span>Negative keyword</span>
          </label>
          <button
            type="button"
            className="btn-pib-accent text-sm"
            onClick={handleAdd}
            disabled={adding || !form.text.trim()}
          >
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
        {addError && (
          <p className="text-xs text-red-300">{addError}</p>
        )}
      </div>
    </div>
  )
}
