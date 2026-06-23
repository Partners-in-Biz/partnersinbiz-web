'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SeoArticle, SeoBlock, SeoBlockType } from '@/lib/content/types'
import { blocksToPlainText } from '@/lib/content/types'
import { fleschReadingEase, readabilityGrade, runSeoChecklist, seoScorePercent } from '@/lib/content/seo-score'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function newBlockId() {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function emptyBlock(type: SeoBlockType): SeoBlock {
  const base: SeoBlock = { id: newBlockId(), type }
  if (type === 'heading') base.level = 2
  if (type === 'list') {
    base.items = ['']
    base.ordered = false
  }
  if (type === 'image') {
    base.src = ''
    base.alt = ''
  }
  if (type === 'paragraph' || type === 'quote') base.text = ''
  return base
}

export default function SeoEditorPage({ params }: { params: Promise<{ articleId: string }> }) {
  const { articleId } = use(params)
  const router = useRouter()

  const [article, setArticle] = useState<SeoArticle | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [busy, setBusy] = useState(false)
  const [scheduleAt, setScheduleAt] = useState('')

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipNextAutosave = useRef(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError(null)
      try {
        const res = await fetch(`/api/v1/admin/content/seo/${articleId}`)
        const body = await res.json()
        if (!res.ok) {
          if (!cancelled) setLoadError(body?.error ?? 'Failed to load article')
          return
        }
        if (!cancelled) {
          const a = body.data as SeoArticle
          setArticle(a)
          if (a.scheduledFor) {
            // datetime-local wants 'YYYY-MM-DDTHH:mm'
            setScheduleAt(new Date(a.scheduledFor).toISOString().slice(0, 16))
          }
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load article')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [articleId])

  // Auto-save (debounced ~1.5s) whenever editable fields change.
  const autosaveDeps = article
    ? JSON.stringify({
        title: article.title,
        metaTitle: article.metaTitle,
        metaDescription: article.metaDescription,
        keyword: article.keyword,
        body: article.body,
      })
    : ''

  const persist = useCallback(
    async (patch: Partial<SeoArticle>) => {
      setSaveState('saving')
      try {
        const res = await fetch(`/api/v1/admin/content/seo/${articleId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
        const body = await res.json()
        if (!res.ok) {
          setSaveState('error')
          return null
        }
        setSaveState('saved')
        return body.data as SeoArticle
      } catch {
        setSaveState('error')
        return null
      }
    },
    [articleId],
  )

  useEffect(() => {
    if (!article) return
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false
      return
    }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      persist({
        title: article.title,
        metaTitle: article.metaTitle,
        metaDescription: article.metaDescription,
        keyword: article.keyword,
        body: article.body,
      })
    }, 1500)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosaveDeps])

  const checklist = useMemo(
    () =>
      article
        ? runSeoChecklist({
            title: article.title,
            metaTitle: article.metaTitle,
            metaDescription: article.metaDescription,
            keyword: article.keyword,
            body: article.body,
          })
        : [],
    [article],
  )
  const score = seoScorePercent(checklist)
  const readability = useMemo(() => {
    if (!article) return 0
    return fleschReadingEase(`${article.title}. ${blocksToPlainText(article.body)}`)
  }, [article])

  function patchLocal(partial: Partial<SeoArticle>) {
    setArticle((prev) => (prev ? { ...prev, ...partial } : prev))
  }

  function updateBlock(id: string, partial: Partial<SeoBlock>) {
    setArticle((prev) =>
      prev ? { ...prev, body: prev.body.map((b) => (b.id === id ? { ...b, ...partial } : b)) } : prev,
    )
  }

  function addBlock(type: SeoBlockType) {
    setArticle((prev) => (prev ? { ...prev, body: [...prev.body, emptyBlock(type)] } : prev))
  }

  function removeBlock(id: string) {
    setArticle((prev) => (prev ? { ...prev, body: prev.body.filter((b) => b.id !== id) } : prev))
  }

  function moveBlock(id: string, dir: -1 | 1) {
    setArticle((prev) => {
      if (!prev) return prev
      const idx = prev.body.findIndex((b) => b.id === id)
      if (idx < 0) return prev
      const next = idx + dir
      if (next < 0 || next >= prev.body.length) return prev
      const body = [...prev.body]
      ;[body[idx], body[next]] = [body[next], body[idx]]
      return { ...prev, body }
    })
  }

  async function flushThen(action: () => Promise<void>) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  async function publish() {
    if (!article) return
    await flushThen(async () => {
      const updated = await persist({
        title: article.title,
        metaTitle: article.metaTitle,
        metaDescription: article.metaDescription,
        keyword: article.keyword,
        body: article.body,
        status: 'published',
      })
      if (updated) {
        skipNextAutosave.current = true
        setArticle(updated)
      }
    })
  }

  async function unpublish() {
    if (!article) return
    await flushThen(async () => {
      const updated = await persist({ status: 'draft' })
      if (updated) {
        skipNextAutosave.current = true
        setArticle(updated)
      }
    })
  }

  async function schedule() {
    if (!article || !scheduleAt) return
    await flushThen(async () => {
      const iso = new Date(scheduleAt).toISOString()
      const updated = await persist({
        title: article.title,
        metaTitle: article.metaTitle,
        metaDescription: article.metaDescription,
        keyword: article.keyword,
        body: article.body,
        status: 'scheduled',
        scheduledFor: iso,
      })
      if (updated) {
        skipNextAutosave.current = true
        setArticle(updated)
      }
    })
  }

  async function remove() {
    if (!article) return
    if (!confirm('Delete this article? This cannot be undone.')) return
    await flushThen(async () => {
      const res = await fetch(`/api/v1/admin/content/seo/${articleId}`, { method: 'DELETE' })
      if (res.ok) router.push('/admin/content/seo')
    })
  }

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-3">
        <div className="pib-skeleton h-10 w-64 rounded-lg" />
        <div className="pib-skeleton h-96 rounded-xl" />
      </div>
    )
  }
  if (loadError || !article) {
    return (
      <div className="max-w-3xl mx-auto pib-card p-8 text-center space-y-3">
        <p className="text-sm text-red-400">{loadError ?? 'Article not found'}</p>
        <Link href="/admin/content/seo" className="pib-btn-ghost text-sm font-label inline-block">
          Back to articles
        </Link>
      </div>
    )
  }

  const saveLabel =
    saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Save failed' : ''

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/admin/content/seo" className="pib-btn-ghost text-xs font-label shrink-0">
            ← Articles
          </Link>
          <span
            className={`text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full ${
              article.status === 'published'
                ? 'bg-green-500/10 text-green-400'
                : article.status === 'scheduled'
                  ? 'bg-amber-500/10 text-amber-400'
                  : 'bg-on-surface/10 text-on-surface-variant'
            }`}
          >
            {article.status}
          </span>
          {saveLabel && (
            <span
              className={`text-xs ${saveState === 'error' ? 'text-red-400' : 'text-on-surface-variant'} inline-flex items-center gap-1`}
            >
              <span className="material-symbols-outlined text-sm">
                {saveState === 'saving' ? 'sync' : saveState === 'error' ? 'error' : 'cloud_done'}
              </span>
              {saveLabel}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {article.status === 'published' ? (
            <button onClick={unpublish} disabled={busy} className="pib-btn-ghost text-sm font-label">
              Unpublish
            </button>
          ) : (
            <button onClick={publish} disabled={busy} className="pib-btn-primary text-sm font-label">
              {busy ? 'Working…' : 'Publish now'}
            </button>
          )}
          <button onClick={remove} disabled={busy} className="pib-btn-ghost text-sm font-label text-red-400">
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        {/* Editor column */}
        <div className="space-y-4">
          <div className="pib-card p-5 space-y-4">
            <label className="block">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">Title</span>
              <input
                value={article.title}
                onChange={(e) => patchLocal({ title: e.target.value })}
                className="pib-input w-full mt-1 text-lg font-headline"
                placeholder="Article title"
              />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                  Focus keyword
                </span>
                <input
                  value={article.keyword}
                  onChange={(e) => patchLocal({ keyword: e.target.value })}
                  className="pib-input w-full mt-1"
                  placeholder="e.g. social media automation"
                />
              </label>
              <label className="block">
                <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">Slug</span>
                <input
                  value={article.slug}
                  onChange={(e) => patchLocal({ slug: e.target.value })}
                  onBlur={() => persist({ slug: article.slug })}
                  className="pib-input w-full mt-1 font-mono text-sm"
                  placeholder="article-slug"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Meta title ({(article.metaTitle || '').length}/60)
              </span>
              <input
                value={article.metaTitle}
                onChange={(e) => patchLocal({ metaTitle: e.target.value })}
                className="pib-input w-full mt-1"
                placeholder="SEO meta title"
              />
            </label>
            <label className="block">
              <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                Meta description ({(article.metaDescription || '').length}/160)
              </span>
              <textarea
                value={article.metaDescription}
                onChange={(e) => patchLocal({ metaDescription: e.target.value })}
                className="pib-input w-full mt-1 min-h-[64px]"
                rows={2}
                placeholder="The snippet shown on search engine results pages."
              />
            </label>
          </div>

          {/* Blocks */}
          <div className="space-y-3">
            {article.body.map((block, i) => (
              <div key={block.id} className="pib-card p-4 group">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                    {block.type}
                    {block.type === 'heading' ? ` H${block.level ?? 2}` : ''}
                  </span>
                  <div className="flex items-center gap-1">
                    {block.type === 'heading' && (
                      <select
                        value={block.level ?? 2}
                        onChange={(e) => updateBlock(block.id, { level: Number(e.target.value) === 3 ? 3 : 2 })}
                        className="pib-input text-xs py-1 px-2"
                      >
                        <option value={2}>H2</option>
                        <option value={3}>H3</option>
                      </select>
                    )}
                    <button
                      onClick={() => moveBlock(block.id, -1)}
                      disabled={i === 0}
                      className="pib-btn-ghost text-xs px-2 py-1 disabled:opacity-30"
                      title="Move up"
                    >
                      <span className="material-symbols-outlined text-sm">arrow_upward</span>
                    </button>
                    <button
                      onClick={() => moveBlock(block.id, 1)}
                      disabled={i === article.body.length - 1}
                      className="pib-btn-ghost text-xs px-2 py-1 disabled:opacity-30"
                      title="Move down"
                    >
                      <span className="material-symbols-outlined text-sm">arrow_downward</span>
                    </button>
                    <button
                      onClick={() => removeBlock(block.id)}
                      className="pib-btn-ghost text-xs px-2 py-1 text-red-400"
                      title="Remove"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
                  </div>
                </div>

                {(block.type === 'heading' || block.type === 'paragraph' || block.type === 'quote') && (
                  <textarea
                    value={block.text ?? ''}
                    onChange={(e) => updateBlock(block.id, { text: e.target.value })}
                    className="pib-input w-full min-h-[60px]"
                    rows={block.type === 'paragraph' ? 4 : 2}
                    placeholder={
                      block.type === 'heading' ? 'Subheading' : block.type === 'quote' ? 'Quote text' : 'Paragraph text'
                    }
                  />
                )}

                {block.type === 'image' && (
                  <div className="space-y-2">
                    <input
                      value={block.src ?? ''}
                      onChange={(e) => updateBlock(block.id, { src: e.target.value })}
                      className="pib-input w-full"
                      placeholder="Image URL (https://…)"
                    />
                    <input
                      value={block.alt ?? ''}
                      onChange={(e) => updateBlock(block.id, { alt: e.target.value })}
                      className="pib-input w-full"
                      placeholder="Alt text (required for SEO)"
                    />
                  </div>
                )}

                {block.type === 'list' && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs text-on-surface-variant">
                      <input
                        type="checkbox"
                        checked={Boolean(block.ordered)}
                        onChange={(e) => updateBlock(block.id, { ordered: e.target.checked })}
                        className="h-4 w-4"
                      />
                      Ordered (numbered) list
                    </label>
                    {(block.items ?? []).map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          value={item}
                          onChange={(e) => {
                            const items = [...(block.items ?? [])]
                            items[idx] = e.target.value
                            updateBlock(block.id, { items })
                          }}
                          className="pib-input w-full"
                          placeholder={`List item ${idx + 1}`}
                        />
                        <button
                          onClick={() => {
                            const items = (block.items ?? []).filter((_, j) => j !== idx)
                            updateBlock(block.id, { items: items.length ? items : [''] })
                          }}
                          className="pib-btn-ghost text-xs px-2 py-1 text-red-400 shrink-0"
                        >
                          <span className="material-symbols-outlined text-sm">close</span>
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => updateBlock(block.id, { items: [...(block.items ?? []), ''] })}
                      className="pib-btn-ghost text-xs font-label"
                    >
                      + Add item
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="pib-card p-3 flex flex-wrap gap-2">
            <span className="text-xs text-on-surface-variant self-center mr-1">Add block:</span>
            {(['heading', 'paragraph', 'image', 'quote', 'list'] as SeoBlockType[]).map((t) => (
              <button key={t} onClick={() => addBlock(t)} className="pib-btn-secondary text-xs font-label capitalize">
                + {t}
              </button>
            ))}
          </div>
        </div>

        {/* Sidebar: score, checklist, readability, schedule, preview */}
        <div className="space-y-4">
          <div className="pib-card p-4">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">SEO score</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span
                className="text-3xl font-headline font-bold"
                style={{ color: score >= 80 ? '#34d399' : score >= 50 ? '#fbbf24' : '#f87171' }}
              >
                {score}
              </span>
              <span className="text-sm text-on-surface-variant">/ 100</span>
            </div>
            <div className="mt-3 space-y-2">
              {checklist.map((c) => (
                <div key={c.id} className="flex items-start gap-2 text-sm">
                  <span
                    className="material-symbols-outlined text-base mt-0.5"
                    style={{ color: c.pass ? '#34d399' : '#f87171' }}
                  >
                    {c.pass ? 'check_circle' : 'cancel'}
                  </span>
                  <span className="min-w-0">
                    <span className="text-on-surface block leading-tight">{c.label}</span>
                    <span className="text-xs text-on-surface-variant">{c.detail}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="pib-card p-4">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Readability</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-headline font-bold text-on-surface">{readability}</span>
              <span className="text-sm text-on-surface-variant">{readabilityGrade(readability)}</span>
            </div>
            <p className="text-xs text-on-surface-variant mt-1">Flesch reading-ease (higher is easier to read).</p>
          </div>

          <div className="pib-card p-4 space-y-2">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Schedule</p>
            <input
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              className="pib-input w-full"
            />
            <button
              onClick={schedule}
              disabled={busy || !scheduleAt}
              className="pib-btn-secondary text-sm font-label w-full"
            >
              {article.status === 'scheduled' ? 'Reschedule' : 'Schedule publish'}
            </button>
            {article.status === 'scheduled' && article.scheduledFor && (
              <p className="text-xs text-amber-400">
                Scheduled for {new Date(article.scheduledFor).toLocaleString()}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Preview panel */}
      <div className="pib-card p-6">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-3">Preview</p>
        <article className="prose-content max-w-2xl">
          <h1 className="text-2xl font-headline font-bold text-on-surface mb-1">{article.title || 'Untitled'}</h1>
          <p className="text-xs text-on-surface-variant font-mono mb-4">/{article.slug}</p>
          {article.body.map((b) => {
            if (b.type === 'heading') {
              return b.level === 3 ? (
                <h3 key={b.id} className="text-base font-semibold text-on-surface mt-4 mb-1">
                  {b.text}
                </h3>
              ) : (
                <h2 key={b.id} className="text-lg font-headline font-bold text-on-surface mt-5 mb-2">
                  {b.text}
                </h2>
              )
            }
            if (b.type === 'paragraph')
              return (
                <p key={b.id} className="text-sm text-on-surface-variant leading-relaxed mb-3">
                  {b.text}
                </p>
              )
            if (b.type === 'quote')
              return (
                <blockquote
                  key={b.id}
                  className="border-l-2 pl-4 my-3 italic text-on-surface-variant"
                  style={{ borderColor: 'var(--color-accent-v2)' }}
                >
                  {b.text}
                </blockquote>
              )
            if (b.type === 'image')
              return b.src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={b.id} src={b.src} alt={b.alt ?? ''} className="rounded-lg my-3 max-w-full" />
              ) : (
                <div
                  key={b.id}
                  className="my-3 rounded-lg border border-dashed border-[var(--color-card-border)] p-6 text-center text-xs text-on-surface-variant"
                >
                  Image placeholder — add a URL
                </div>
              )
            if (b.type === 'list') {
              const items = (b.items ?? []).filter(Boolean)
              return b.ordered ? (
                <ol key={b.id} className="list-decimal pl-5 text-sm text-on-surface-variant mb-3 space-y-1">
                  {items.map((it, i) => (
                    <li key={i}>{it}</li>
                  ))}
                </ol>
              ) : (
                <ul key={b.id} className="list-disc pl-5 text-sm text-on-surface-variant mb-3 space-y-1">
                  {items.map((it, i) => (
                    <li key={i}>{it}</li>
                  ))}
                </ul>
              )
            }
            return null
          })}
        </article>
      </div>
    </div>
  )
}
