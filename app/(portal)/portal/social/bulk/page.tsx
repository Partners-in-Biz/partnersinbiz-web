'use client'
export const dynamic = 'force-dynamic'

import { useState, useRef } from 'react'
import { useOrg } from '@/lib/contexts/OrgContext'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface BulkPostRow {
  content: string
  platforms: string[]
  scheduledAt: string
  category: string
  hashtags: string[]
  tags: string[]
}

interface BulkResult {
  index: number
  success: boolean
  id?: string
  error?: string
}

const PLATFORMS = [
  { id: 'twitter', label: 'X (Twitter)', color: 'bg-black', short: 'X' },
  { id: 'linkedin', label: 'LinkedIn', color: 'bg-blue-700', short: 'LI' },
  { id: 'facebook', label: 'Facebook', color: 'bg-blue-600', short: 'FB' },
  { id: 'instagram', label: 'Instagram', color: 'bg-pink-600', short: 'IG' },
  { id: 'reddit', label: 'Reddit', color: 'bg-orange-600', short: 'RD' },
  { id: 'tiktok', label: 'TikTok', color: 'bg-gray-800', short: 'TT' },
  { id: 'pinterest', label: 'Pinterest', color: 'bg-red-700', short: 'PI' },
  { id: 'bluesky', label: 'Bluesky', color: 'bg-sky-500', short: 'BS' },
  { id: 'threads', label: 'Threads', color: 'bg-gray-700', short: 'TH' },
]

const CATEGORIES = ['work', 'personal', 'ai', 'sport', 'sa', 'other']

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function PlatformBadge({ platform }: { platform: string }) {
  const cfg = PLATFORMS.find(p => p.id === platform)
  if (!cfg) return <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-surface-container-high text-on-surface-variant uppercase">{platform}</span>
  return <span className={`${cfg.color} text-white text-[10px] px-1.5 py-0.5 rounded font-bold`}>{cfg.short}</span>
}

function emptyRow(): BulkPostRow {
  return { content: '', platforms: ['twitter'], scheduledAt: '', category: 'work', hashtags: [], tags: [] }
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function BulkComposePage() {
  const { orgId } = useOrg()
  const [rows, setRows] = useState<BulkPostRow[]>([emptyRow()])
  const [csvPreview, setCsvPreview] = useState<BulkPostRow[] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [results, setResults] = useState<{ total: number; succeeded: number; failed: number; results: BulkResult[] } | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const updateRow = (i: number, updates: Partial<BulkPostRow>) => {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...updates } : r))
  }

  const addRow = () => setRows(prev => [...prev, emptyRow()])

  const removeRow = (i: number) => {
    if (rows.length <= 1) return
    setRows(prev => prev.filter((_, idx) => idx !== i))
  }

  const togglePlatform = (rowIdx: number, platformId: string) => {
    setRows(prev => prev.map((r, idx) => {
      if (idx !== rowIdx) return r
      const platforms = r.platforms.includes(platformId)
        ? r.platforms.filter(p => p !== platformId)
        : [...r.platforms, platformId]
      return { ...r, platforms: platforms.length > 0 ? platforms : r.platforms }
    }))
  }

  // CSV upload handler
  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setResults(null)

    const text = await file.text()
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) { setError('CSV has no data rows'); return }

    const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/^"|"$/g, ''))

    const contentIdx = headers.findIndex(h => h === 'content' || h === 'text')
    if (contentIdx === -1) { setError('CSV must have a "content" or "text" column'); return }

    const platformIdx = headers.findIndex(h => h === 'platforms' || h === 'platform')
    const schedIdx = headers.findIndex(h => h.includes('scheduled') || h.includes('date'))
    const catIdx = headers.findIndex(h => h === 'category')
    const hashIdx = headers.findIndex(h => h === 'hashtags')
    const tagIdx = headers.findIndex(h => h === 'tags')

    const preview: BulkPostRow[] = []
    for (let i = 1; i < lines.length && i <= 51; i++) {
      const vals = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''))
      if (!vals[contentIdx]) continue
      preview.push({
        content: vals[contentIdx],
        platforms: platformIdx >= 0 && vals[platformIdx] ? vals[platformIdx].split(/[;|]/).map(p => p.trim()) : ['twitter'],
        scheduledAt: schedIdx >= 0 ? vals[schedIdx] ?? '' : '',
        category: catIdx >= 0 ? vals[catIdx] ?? 'other' : 'other',
        hashtags: hashIdx >= 0 && vals[hashIdx] ? vals[hashIdx].split(/[;|]/).map(h => h.trim()) : [],
        tags: tagIdx >= 0 && vals[tagIdx] ? vals[tagIdx].split(/[;|]/).map(t => t.trim()) : [],
      })
    }

    setCsvPreview(preview)
  }

  // Submit bulk posts (manual or CSV)
  const handleSubmit = async (source: 'manual' | 'csv') => {
    setError('')
    setResults(null)
    setSubmitting(true)

    try {
      if (source === 'csv' && fileRef.current?.files?.[0]) {
        const formData = new FormData()
        formData.append('file', fileRef.current.files[0])
        const res = await fetch(`/api/v1/social/posts/bulk${orgId ? `?orgId=${orgId}` : ''}`, {
          method: 'POST',
          body: formData,
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? 'Bulk import failed')
        setResults(body.data)
        setCsvPreview(null)
      } else {
        const validRows = rows.filter(r => r.content.trim())
        if (validRows.length === 0) { setError('Add at least one post with content'); setSubmitting(false); return }

        const res = await fetch(`/api/v1/social/posts/bulk${orgId ? `?orgId=${orgId}` : ''}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            posts: validRows.map(r => ({
              content: r.content,
              platforms: r.platforms,
              scheduledAt: r.scheduledAt || undefined,
              category: r.category,
              hashtags: r.hashtags,
              tags: r.tags,
            })),
          }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? 'Bulk create failed')
        setResults(body.data)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const minDateTime = new Date().toISOString().slice(0, 16)

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-on-surface">Bulk Compose</h1>
        <p className="text-sm text-on-surface-variant mt-1">Create multiple social posts at once or import from CSV</p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-900/30 text-red-400 text-sm">{error}</div>
      )}

      {results && (
        <div className="rounded-xl bg-surface-container p-4 space-y-2">
          <div className="flex gap-4">
            <span className="text-sm text-on-surface">{results.total} total</span>
            <span className="text-sm text-green-400">{results.succeeded} created</span>
            {results.failed > 0 && <span className="text-sm text-red-400">{results.failed} failed</span>}
          </div>
          {results.results.filter(r => !r.success).length > 0 && (
            <div className="space-y-1">
              {results.results.filter(r => !r.success).map(r => (
                <p key={r.index} className="text-xs text-red-400">Row {r.index + 1}: {r.error}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CSV Import */}
      <div className="rounded-xl bg-surface-container p-5 space-y-3">
        <h2 className="text-sm font-semibold text-on-surface">Import from CSV</h2>
        <p className="text-xs text-on-surface-variant">
          Required column: <code className="text-on-surface">content</code>. Optional: <code className="text-on-surface">platforms</code> (semicolon-separated), <code className="text-on-surface">scheduled_at</code>, <code className="text-on-surface">category</code>, <code className="text-on-surface">hashtags</code>, <code className="text-on-surface">tags</code>
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleCsvUpload}
          className="block text-sm text-on-surface-variant file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-surface-container-high file:text-on-surface file:text-xs file:font-medium file:cursor-pointer hover:file:bg-surface-container"
        />

        {csvPreview && (
          <div className="space-y-2">
            <p className="text-xs text-on-surface-variant">{csvPreview.length} rows found</p>
            <div className="max-h-48 overflow-y-auto rounded-lg bg-surface p-2 space-y-1">
              {csvPreview.slice(0, 10).map((row, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-on-surface-variant shrink-0 w-6">{i + 1}.</span>
                  <span className="text-on-surface truncate flex-1">{row.content.slice(0, 80)}</span>
                  <div className="flex gap-1 shrink-0">
                    {row.platforms.map(p => <PlatformBadge key={p} platform={p} />)}
                  </div>
                </div>
              ))}
              {csvPreview.length > 10 && (
                <p className="text-[10px] text-on-surface-variant pl-6">...and {csvPreview.length - 10} more</p>
              )}
            </div>
            <button
              onClick={() => handleSubmit('csv')}
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-white text-black font-label text-sm font-medium hover:bg-white/90 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Importing…' : `Import ${csvPreview.length} Posts`}
            </button>
          </div>
        )}
      </div>

      {/* Manual bulk compose */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-on-surface">Manual Bulk Compose</h2>
          <button
            onClick={addRow}
            className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface font-label text-xs font-medium hover:bg-surface-container-high transition-colors"
          >
            + Add Post
          </button>
        </div>

        {rows.map((row, i) => (
          <div key={i} className="rounded-xl bg-surface-container p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-on-surface-variant">Post {i + 1}</span>
              {rows.length > 1 && (
                <button
                  onClick={() => removeRow(i)}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>

            <textarea
              rows={3}
              value={row.content}
              onChange={(e) => updateRow(i, { content: e.target.value })}
              placeholder="Write your post content..."
              className="w-full bg-surface rounded-lg px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/50 resize-none outline-none"
            />

            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map(p => (
                <button
                  key={p.id}
                  onClick={() => togglePlatform(i, p.id)}
                  className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${
                    row.platforms.includes(p.id)
                      ? `${p.color} text-white`
                      : 'bg-surface text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  {p.short}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-3 items-center">
              <input
                type="datetime-local"
                value={row.scheduledAt}
                min={minDateTime}
                onChange={(e) => updateRow(i, { scheduledAt: e.target.value })}
                className="rounded-lg bg-surface px-3 py-1.5 text-xs text-on-surface outline-none"
              />
              <select
                value={row.category}
                onChange={(e) => updateRow(i, { category: e.target.value })}
                className="rounded-lg bg-surface px-2 py-1.5 text-xs text-on-surface outline-none capitalize"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
        ))}

        <button
          onClick={() => handleSubmit('manual')}
          disabled={submitting}
          className="px-4 py-2 rounded-lg bg-white text-black font-label text-sm font-medium hover:bg-white/90 transition-colors disabled:opacity-50"
        >
          {submitting ? 'Creating…' : `Create ${rows.filter(r => r.content.trim()).length} Posts`}
        </button>
      </div>
    </div>
  )
}
