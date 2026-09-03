'use client'

import { Icon } from '@/components/studio'
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
  if (!cfg) return <span className="pib-pill uppercase">{platform}</span>
  return <span className={`${cfg.color} text-white text-[10px] px-1.5 py-0.5 rounded `}>{cfg.short}</span>
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
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <header>
        <p className="sc-tiny">Social · Bulk</p>
        <h1 className="pib-page-title mt-2">Bulk Compose</h1>
        <p className="pib-page-sub">Create multiple social posts at once or import from CSV</p>
      </header>

      {error && (
        <div className="pib-card border-[var(--color-error)]/40 text-sm text-[var(--color-error)]">{error}</div>
      )}

      {results && (
        <div className="pib-card space-y-2">
          <div className="flex flex-wrap gap-2">
            <span className="pib-pill">{results.total} total</span>
            <span className="pib-pill pib-pill-success">{results.succeeded} created</span>
            {results.failed > 0 && <span className="pib-pill pib-pill-danger">{results.failed} failed</span>}
          </div>
          {results.results.filter(r => !r.success).length > 0 && (
            <div className="space-y-1">
              {results.results.filter(r => !r.success).map(r => (
                <p key={r.index} className="text-xs text-[var(--color-error)]">Row {r.index + 1}: {r.error}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CSV Import */}
      <div className="pib-card space-y-4">
        <div className="flex items-center gap-3">
          <span>
            <Icon name="upload_file" />
          </span>
          <h2 className="pib-label">Import from CSV</h2>
        </div>
        <p className="text-xs text-[var(--color-pib-text-muted)]">
          Required column: <code className="text-[var(--color-pib-text)]">content</code>. Optional: <code className="text-[var(--color-pib-text)]">platforms</code> (semicolon-separated), <code className="text-[var(--color-pib-text)]">scheduled_at</code>, <code className="text-[var(--color-pib-text)]">category</code>, <code className="text-[var(--color-pib-text)]">hashtags</code>, <code className="text-[var(--color-pib-text)]">tags</code>
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleCsvUpload}
          aria-label="Upload CSV"
          className="block text-sm text-[var(--color-pib-text-muted)] file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-[var(--color-pib-surface)] file:text-[var(--color-pib-text)] file:text-xs file:font-medium file:cursor-pointer"
         aria-label="Upload file"/>

        {csvPreview && (
          <div className="space-y-2">
            <p className="text-xs text-[var(--color-pib-text-muted)]">{csvPreview.length} rows found</p>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--color-pib-line)] p-2 space-y-1">
              {csvPreview.slice(0, 10).map((row, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-[var(--color-pib-text-muted)] shrink-0 w-6">{i + 1}.</span>
                  <span className="text-[var(--color-pib-text)] truncate flex-1">{row.content.slice(0, 80)}</span>
                  <div className="flex gap-1 shrink-0">
                    {row.platforms.map(p => <PlatformBadge key={p} platform={p} />)}
                  </div>
                </div>
              ))}
              {csvPreview.length > 10 && (
                <p className="text-[10px] text-[var(--color-pib-text-muted)] pl-6">...and {csvPreview.length - 10} more</p>
              )}
            </div>
            <button
              onClick={() => handleSubmit('csv')}
              disabled={submitting}
              className="btn-pib-primary disabled:opacity-50"
            >
              {submitting ? 'Importing…' : `Import ${csvPreview.length} Posts`}
            </button>
          </div>
        )}
      </div>

      {/* Manual bulk compose */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="pib-label">Manual Bulk Compose</h2>
          <button
            onClick={addRow}
            className="btn-pib-secondary text-xs"
          >
            + Add Post
          </button>
        </div>

        {rows.map((row, i) => (
          <div key={i} className="pib-card space-y-4">
            <div className="flex items-center justify-between">
              <span className="pib-label">Post {i + 1}</span>
              {rows.length > 1 && (
                <button
                  onClick={() => removeRow(i)}
                  className="text-xs text-[var(--color-error)] hover:opacity-80 transition-opacity"
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
              aria-label="Post content"
              className="pib-textarea w-full resize-none"
             aria-label="Write your post content..."/>

            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map(p => (
                <button
                  key={p.id}
                  onClick={() => togglePlatform(i, p.id)}
                  className={`px-2 py-1 rounded text-[10px]  transition-colors ${
                    row.platforms.includes(p.id)
                      ? `${p.color} text-white`
                      : 'border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)]'
                  }`}
                >
                  {p.short}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-3 items-center">
              <input
                type="datetime-local"
                aria-label="Schedule date and time"
                value={row.scheduledAt}
                min={minDateTime}
                onChange={(e) => updateRow(i, { scheduledAt: e.target.value })}
                className="pib-input text-xs"
               aria-label="Date and time"/>
              <select
                value={row.category}
                onChange={(e) => updateRow(i, { category: e.target.value })}
                className="pib-select text-xs capitalize" aria-label="Category"
               aria-label="Input">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
        ))}

        <button
          onClick={() => handleSubmit('manual')}
          disabled={submitting}
          className="btn-pib-primary disabled:opacity-50"
        >
          {submitting ? 'Creating…' : `Create ${rows.filter(r => r.content.trim()).length} Posts`}
        </button>
      </div>
    </div>
  )
}
