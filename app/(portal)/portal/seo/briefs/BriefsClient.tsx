'use client'

import { useState } from 'react'
import { SeoToolHeader, type SprintOption } from '@/components/seo/SeoToolHeader'
import { briefToMarkdown, type ContentBrief } from '@/lib/seo/content-brief'

export type SavedBrief = {
  id: string
  keyword: string
  title: string
  savedAt: string
  brief: ContentBrief
}

export function BriefsClient({
  sprints,
  activeSprintId,
  clientName,
  savedBriefs,
  prefillKeyword,
  prefillCompetitor,
}: {
  sprints: SprintOption[]
  activeSprintId?: string
  clientName?: string
  savedBriefs: SavedBrief[]
  prefillKeyword: string
  prefillCompetitor: string
}) {
  const [keyword, setKeyword] = useState(prefillKeyword)
  const [targetUrl, setTargetUrl] = useState('')
  const [competitor, setCompetitor] = useState(prefillCompetitor)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [brief, setBrief] = useState<ContentBrief | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  async function generate() {
    if (!keyword.trim()) return
    setLoading(true)
    setError(null)
    setBrief(null)
    try {
      const res = await fetch('/api/v1/seo/briefs/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim(), targetUrl: targetUrl.trim() || undefined, competitor: competitor.trim() || undefined, sprintId: activeSprintId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(json?.error ?? `Request failed (${res.status})`)
      setBrief(json.data as ContentBrief)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Brief generation failed')
    } finally {
      setLoading(false)
    }
  }

  async function copyToClipboard() {
    if (!brief) return
    try {
      await navigator.clipboard.writeText(briefToMarkdown(brief))
      showToast('Brief copied to clipboard')
    } catch {
      showToast('Clipboard not available')
    }
  }

  async function save() {
    if (!brief || !activeSprintId) return
    setSaving(true)
    try {
      const res = await fetch('/api/v1/seo/briefs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sprintId: activeSprintId, brief }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(json?.error ?? `Request failed (${res.status})`)
      showToast('Brief saved')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save brief')
    } finally {
      setSaving(false)
    }
  }

  async function downloadPdf() {
    if (!brief) return
    setPdfLoading(true)
    try {
      const res = await fetch('/api/v1/seo/briefs/pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief, clientName }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error ?? `Request failed (${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `content-brief-${brief.keyword.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to download PDF')
    } finally {
      setPdfLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <SeoToolHeader
        eyebrow="Content SEO"
        title="AI content-brief generator"
        description="Generate a structured SEO brief — title, meta, H2 outline, semantic keywords, word count and FAQs — from a keyword. Copy, save, or export to PDF."
        sprints={sprints}
        activeSprintId={activeSprintId}
      />

      <section className="pib-card-section">
        <div className="pib-card-section-header">
          <h3 className="text-sm font-semibold">Brief inputs</h3>
          <p className="text-xs text-[var(--color-pib-text-muted)]">Keyword is required. URL and competitor sharpen the brief.</p>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <div>
            <label className="pib-label" htmlFor="kw">Target keyword *</label>
            <input id="kw" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="property management software" className="pib-input" disabled={loading} />
          </div>
          <div>
            <label className="pib-label" htmlFor="url">Target URL (optional)</label>
            <input id="url" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://yoursite.com/page" className="pib-input" disabled={loading} />
          </div>
          <div>
            <label className="pib-label" htmlFor="comp">Competitor (optional)</label>
            <input id="comp" value={competitor} onChange={(e) => setCompetitor(e.target.value)} placeholder="competitor.com" className="pib-input" disabled={loading} />
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 pb-4">
          <button onClick={generate} disabled={loading || !keyword.trim()} className="pib-btn-primary text-sm disabled:opacity-40">
            {loading ? (
              <>
                <span className="material-symbols-outlined animate-spin text-[18px]">autorenew</span>
                Generating…
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                Generate brief
              </>
            )}
          </button>
          {error && (
            <span className="flex items-center gap-1.5 text-xs text-red-300">
              <span className="material-symbols-outlined text-sm">error</span>
              {error}
            </span>
          )}
        </div>
      </section>

      {brief && (
        <section className="pib-card-section">
          <div className="pib-card-section-header flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold">Brief: {brief.keyword}</h3>
              <p className="text-xs text-[var(--color-pib-text-muted)]">{brief.generatedBy === 'ai' ? 'Generated with AI.' : 'Template fallback (AI unavailable).'}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={copyToClipboard} className="pib-btn-secondary text-sm">
                <span className="material-symbols-outlined text-[18px]">content_copy</span>
                Copy
              </button>
              <button onClick={save} disabled={saving || !activeSprintId} className="pib-btn-secondary text-sm disabled:opacity-40">
                <span className="material-symbols-outlined text-[18px]">save</span>
                Save
              </button>
              <button onClick={downloadPdf} disabled={pdfLoading} className="pib-btn-secondary text-sm disabled:opacity-40">
                <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
                {pdfLoading ? 'Building…' : 'PDF'}
              </button>
            </div>
          </div>

          <div className="space-y-5 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title tag" value={brief.title} hint={`${brief.title.length}/60`} />
              <Field label="Meta description" value={brief.metaDescription} hint={`${brief.metaDescription.length}/160`} />
              <Field label="Search intent" value={brief.searchIntent} />
              <Field label="Recommended word count" value={`${brief.recommendedWordCount} words`} />
            </div>

            <div>
              <p className="eyebrow !text-[10px] mb-2">H2 outline</p>
              <div className="space-y-2">
                {brief.h2Outline.map((sec, i) => (
                  <div key={i} className="rounded-xl border border-[var(--color-pib-line)] bg-white/[0.02] p-3">
                    <p className="text-sm font-semibold">{i + 1}. {sec.heading}</p>
                    <ul className="mt-1 list-disc pl-5 text-xs text-[var(--color-pib-text-muted)] space-y-0.5">
                      {sec.talkingPoints.map((p, j) => <li key={j}>{p}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="eyebrow !text-[10px] mb-2">Semantic keywords</p>
              <div className="flex flex-wrap gap-2">
                {brief.semanticKeywords.map((k) => <span key={k} className="pib-pill text-xs">{k}</span>)}
              </div>
            </div>

            <div>
              <p className="eyebrow !text-[10px] mb-2">FAQs</p>
              <div className="space-y-2">
                {brief.faqs.map((f, i) => (
                  <div key={i} className="rounded-xl border border-[var(--color-pib-line)] bg-white/[0.02] p-3">
                    <p className="text-sm font-medium">{f.question}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">{f.answerHint}</p>
                  </div>
                ))}
              </div>
            </div>

            {brief.internalLinkIdeas.length > 0 && (
              <div>
                <p className="eyebrow !text-[10px] mb-2">Internal link ideas</p>
                <ul className="list-disc pl-5 text-xs text-[var(--color-pib-text-muted)] space-y-0.5">
                  {brief.internalLinkIdeas.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Saved briefs */}
      {savedBriefs.length > 0 && (
        <section className="pib-card-section overflow-hidden">
          <div className="pib-card-section-header">
            <h3 className="text-sm font-semibold">Saved briefs</h3>
            <p className="text-xs text-[var(--color-pib-text-muted)]">Previously saved briefs for this sprint.</p>
          </div>
          <div className="divide-y divide-[var(--color-pib-line)]">
            {savedBriefs.map((b) => (
              <button
                key={b.id}
                onClick={() => setBrief(b.brief)}
                className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left text-sm hover:bg-[var(--color-pib-surface-2)]"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{b.title}</p>
                  <p className="text-xs text-[var(--color-pib-text-muted)]">{b.keyword}</p>
                </div>
                <span className="text-xs text-[var(--color-pib-text-muted)] shrink-0">{b.savedAt.slice(0, 10)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-4 py-3 text-sm shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  )
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-pib-line)] bg-white/[0.02] p-3">
      <div className="flex items-center justify-between">
        <p className="eyebrow !text-[10px]">{label}</p>
        {hint && <span className="text-[10px] text-[var(--color-pib-text-muted)]">{hint}</span>}
      </div>
      <p className="mt-1 text-sm">{value}</p>
    </div>
  )
}
