'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type ContentType = 'html' | 'mjml'

interface TemplateVersion {
  version: number
  subject: string
  content: string
  contentType: string
  savedAt: string | null
  savedBy: string
}

interface TemplateSummary {
  id: string
  name: string
  subject: string
  contentType: ContentType
  locale: string
  version: number
  versionCount: number
  updatedAt: string | null
}

interface TemplateFull extends TemplateSummary {
  content: string
  versions: TemplateVersion[]
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

const MERGE_TAGS = ['{{firstName}}', '{{name}}', '{{email}}']

export default function EmailTemplatesPage() {
  const [list, setList] = useState<TemplateSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [selected, setSelected] = useState<TemplateFull | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Editor form
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')
  const [contentType, setContentType] = useState<ContentType>('html')
  const [locale, setLocale] = useState('en')
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)

  const [testTo, setTestTo] = useState('')
  const [sendingTest, setSendingTest] = useState(false)

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/admin/email/templates')
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to load templates')
      setList((body.data ?? []) as TemplateSummary[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadList()
  }, [loadList])

  function applyToForm(t: TemplateFull) {
    setName(t.name)
    setSubject(t.subject)
    setContent(t.content)
    setContentType(t.contentType)
    setLocale(t.locale)
  }

  async function openTemplate(id: string) {
    setLoadingDetail(true)
    setError(null)
    setNotice(null)
    setCreating(false)
    try {
      const res = await fetch(`/api/v1/admin/email/templates/${id}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to load template')
      const t = body.data as TemplateFull
      setSelected(t)
      applyToForm(t)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load template')
    } finally {
      setLoadingDetail(false)
    }
  }

  function startCreate() {
    setSelected(null)
    setCreating(true)
    setName('')
    setSubject('')
    setContent('<p>Hi {{firstName}},</p>\n<p>...</p>')
    setContentType('html')
    setLocale('en')
    setNotice(null)
    setError(null)
  }

  async function save() {
    if (!name.trim() || !subject.trim() || !content.trim()) {
      setError('Name, subject and content are required.')
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      let res: Response
      if (creating || !selected) {
        res = await fetch('/api/v1/admin/email/templates', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, subject, content, contentType, locale }),
        })
      } else {
        res = await fetch(`/api/v1/admin/email/templates/${selected.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, subject, content, contentType, locale }),
        })
      }
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to save template')
      const t = body.data as TemplateFull
      setSelected(t)
      applyToForm(t)
      setCreating(false)
      setNotice(`Template "${t.name}" saved (v${t.version}).`)
      await loadList()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  async function restoreVersion(v: number) {
    if (!selected) return
    if (!confirm(`Restore version ${v}? This creates a new version with that content.`)) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/email/templates/${selected.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ restoreVersion: v }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to restore')
      const t = body.data as TemplateFull
      setSelected(t)
      applyToForm(t)
      setNotice(`Restored version ${v} (now v${t.version}).`)
      await loadList()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore')
    } finally {
      setSaving(false)
    }
  }

  async function cloneToLocale() {
    if (!selected) return
    const newLocale = prompt('Clone into which locale? (e.g. af, fr, zu)', 'af')
    if (!newLocale || !newLocale.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/email/templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `${selected.name} (${newLocale.trim()})`,
          locale: newLocale.trim(),
          cloneFrom: selected.id,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to clone')
      setNotice(`Cloned into locale "${newLocale.trim()}".`)
      await loadList()
      await openTemplate(body.data.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clone')
    } finally {
      setSaving(false)
    }
  }

  async function deleteTemplate() {
    if (!selected) return
    if (!confirm(`Delete template "${selected.name}"? This cannot be undone.`)) return
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/admin/email/templates/${selected.id}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to delete')
      setNotice('Template deleted.')
      setSelected(null)
      await loadList()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setSaving(false)
    }
  }

  async function sendTest() {
    if (!testTo.trim()) return
    setSendingTest(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/v1/admin/email/test-send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: testTo.trim(), subject, html: content }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Test send failed')
      setNotice(`Test sent to ${testTo.trim()} via ${body.data.provider}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test send failed')
    } finally {
      setSendingTest(false)
    }
  }

  const editing = creating || !!selected

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Platform / Email
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Email Templates</h1>
          <p className="text-sm text-on-surface-variant mt-0.5 max-w-2xl">
            Manage platform email templates with HTML / MJML content, live preview, version history,
            test sends and per-locale clones.
          </p>
        </div>
        <div className="flex gap-2 self-start md:self-auto">
          <button onClick={startCreate} className="pib-btn-primary text-sm font-label">
            + New template
          </button>
          <Link href="/admin/email" className="pib-btn-ghost text-sm font-label">
            Back
          </Link>
        </div>
      </div>

      {error && (
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">{error}</div>
      )}
      {notice && (
        <div className="pib-card border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-green-400">{notice}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        {/* List */}
        <div className="pib-card p-4 h-fit">
          <p className="text-xs font-label uppercase tracking-wide text-on-surface-variant mb-2">Templates</p>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 rounded-lg" />
              <Skeleton className="h-10 rounded-lg" />
            </div>
          ) : list.length === 0 ? (
            <p className="text-sm text-on-surface-variant">No templates yet.</p>
          ) : (
            <ul className="space-y-1">
              {list.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => openTemplate(t.id)}
                    className={`w-full text-left rounded-md px-3 py-2 text-sm ${
                      selected?.id === t.id
                        ? 'bg-[var(--color-surface-container)] text-on-surface'
                        : 'text-on-surface-variant hover:bg-on-surface/5'
                    }`}
                  >
                    <span className="block truncate">{t.name}</span>
                    <span className="block text-[11px] text-on-surface-variant/70">
                      {t.locale} · {t.contentType} · v{t.version}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Editor */}
        <div className="space-y-4">
          {!editing ? (
            <div className="pib-card p-8 text-center">
              <p className="text-sm text-on-surface-variant">Select a template or create a new one.</p>
            </div>
          ) : loadingDetail ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : (
            <>
              <div className="pib-card p-5 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="text-lg font-headline font-bold text-on-surface">
                    {creating ? 'New template' : `Edit: ${selected?.name}`}
                  </h2>
                  {selected && !creating && (
                    <div className="flex gap-2">
                      <button onClick={cloneToLocale} disabled={saving} className="pib-btn-ghost text-xs font-label">
                        Clone to locale
                      </button>
                      <button onClick={deleteTemplate} disabled={saving} className="pib-btn-ghost text-xs font-label">
                        Delete
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">Name</span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="pib-input w-full mt-1"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">Locale</span>
                    <input
                      type="text"
                      value={locale}
                      onChange={(e) => setLocale(e.target.value)}
                      placeholder="en"
                      className="pib-input w-full mt-1"
                    />
                  </label>
                  <label className="block md:col-span-2">
                    <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">Subject</span>
                    <input
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="pib-input w-full mt-1"
                    />
                  </label>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                    <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                      Content
                    </span>
                    <div className="flex items-center gap-2">
                      {MERGE_TAGS.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setContent((c) => c + ' ' + tag)}
                          className="text-[11px] font-mono px-2 py-0.5 rounded bg-on-surface/10 text-on-surface-variant hover:text-on-surface"
                        >
                          {tag}
                        </button>
                      ))}
                      <select
                        value={contentType}
                        onChange={(e) => setContentType(e.target.value as ContentType)}
                        className="pib-input text-xs py-1"
                      >
                        <option value="html">HTML</option>
                        <option value="mjml">MJML</option>
                      </select>
                    </div>
                  </div>
                  {contentType === 'mjml' && (
                    <p className="text-[11px] text-amber-400 mb-1">
                      MJML is stored as-is. No MJML compiler is installed, so the preview renders the
                      raw markup — compile MJML in your send pipeline before dispatch.
                    </p>
                  )}
                  <div className="grid gap-3 md:grid-cols-2">
                    <textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      className="pib-input w-full font-mono text-xs min-h-[280px]"
                      rows={15}
                    />
                    <iframe
                      title="template-preview"
                      className="w-full min-h-[280px] rounded-md border border-[var(--color-card-border)] bg-white"
                      sandbox=""
                      srcDoc={content}
                    />
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2 sm:items-end border-t border-[var(--color-card-border)] pt-4">
                  <label className="block flex-1">
                    <span className="text-xs font-label uppercase tracking-wide text-on-surface-variant">
                      Send a test to
                    </span>
                    <input
                      type="email"
                      value={testTo}
                      onChange={(e) => setTestTo(e.target.value)}
                      placeholder="you@example.com"
                      className="pib-input w-full mt-1"
                    />
                  </label>
                  <button onClick={sendTest} disabled={sendingTest} className="pib-btn-secondary text-sm font-label">
                    {sendingTest ? 'Sending…' : 'Send test'}
                  </button>
                  <button onClick={save} disabled={saving} className="pib-btn-primary text-sm font-label">
                    {saving ? 'Saving…' : creating ? 'Create' : 'Save changes'}
                  </button>
                </div>
              </div>

              {/* Version history */}
              {selected && selected.versions.length > 0 && (
                <div className="pib-card p-5">
                  <h3 className="text-base font-headline font-bold text-on-surface mb-3">
                    Version history ({selected.versions.length})
                  </h3>
                  <ul className="space-y-2">
                    {[...selected.versions].reverse().map((v) => (
                      <li
                        key={v.version}
                        className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2"
                      >
                        <div className="min-w-0">
                          <span className="text-sm text-on-surface font-label">v{v.version}</span>
                          <span className="text-xs text-on-surface-variant ml-2 truncate">{v.subject}</span>
                          {v.savedAt && (
                            <span className="text-[11px] text-on-surface-variant/60 ml-2">
                              {new Date(v.savedAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => restoreVersion(v.version)}
                          disabled={saving}
                          className="pib-btn-ghost text-xs font-label shrink-0"
                        >
                          Restore
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
