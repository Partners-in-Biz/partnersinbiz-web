'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

interface LegalVersion {
  id: string
  docType: string
  version: number
  title: string
  body: string
  status: 'draft' | 'published' | 'archived'
  effectiveDate: string | null
  publishedAt: string | null
  createdAt?: string
  updatedAt?: string
}

interface Acceptance {
  id: string
  orgId?: string
  userId?: string
  userEmail?: string
  docType?: string
  version?: number
  acceptedAt?: string
  ip?: string
}

const DOC_TABS: { key: string; label: string }[] = [
  { key: 'tos', label: 'Terms of Service' },
  { key: 'privacy', label: 'Privacy Policy' },
]

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    published: 'bg-green-500/10 text-green-400 border-green-500/20',
    draft: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    archived: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  }
  return (
    <span className={`text-[10px] font-label uppercase tracking-widest px-2.5 py-1 rounded-full border ${map[status] ?? map.archived}`}>
      {status}
    </span>
  )
}

export default function LegalPage() {
  const [docType, setDocType] = useState<string>('tos')
  const [versions, setVersions] = useState<LegalVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editEffective, setEditEffective] = useState('')

  const [acceptances, setAcceptances] = useState<Acceptance[]>([])
  const [acceptLoading, setAcceptLoading] = useState(false)

  const selected = useMemo(() => versions.find((v) => v.id === selectedId) ?? null, [versions, selectedId])

  const loadVersions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/legal?docType=${encodeURIComponent(docType)}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to load')
      const data = body.data ?? body
      setVersions(data.versions ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load versions')
    } finally {
      setLoading(false)
    }
  }, [docType])

  const loadAcceptances = useCallback(async () => {
    setAcceptLoading(true)
    try {
      const res = await fetch(`/api/v1/admin/legal/acceptances?docType=${encodeURIComponent(docType)}&limit=200`)
      const body = await res.json()
      const data = body.data ?? body
      setAcceptances(res.ok ? data.acceptances ?? [] : [])
    } catch {
      setAcceptances([])
    } finally {
      setAcceptLoading(false)
    }
  }, [docType])

  useEffect(() => {
    setSelectedId(null)
    loadVersions()
    loadAcceptances()
  }, [loadVersions, loadAcceptances])

  useEffect(() => {
    if (selected) {
      setEditTitle(selected.title ?? '')
      setEditBody(selected.body ?? '')
      setEditEffective(selected.effectiveDate ? selected.effectiveDate.slice(0, 10) : '')
    }
  }, [selected])

  async function createDraft() {
    setBusy(true)
    setFeedback(null)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/legal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType, title: `${docType === 'tos' ? 'Terms of Service' : 'Privacy Policy'} draft`, body: '' }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Create failed')
      const data = body.data ?? body
      setFeedback(`Created draft v${data.version?.version}`)
      await loadVersions()
      setSelectedId(data.version?.id ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  async function saveDraft() {
    if (!selected) return
    setBusy(true)
    setFeedback(null)
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/legal/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle, body: editBody, effectiveDate: editEffective || null }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Save failed')
      setFeedback('Draft saved')
      await loadVersions()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function publish() {
    if (!selected) return
    setBusy(true)
    setFeedback(null)
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/legal/${selected.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ effectiveDate: editEffective || undefined }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Publish failed')
      setFeedback('Version published')
      await loadVersions()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed')
    } finally {
      setBusy(false)
    }
  }

  async function deleteDraft() {
    if (!selected) return
    if (!confirm(`Delete draft v${selected.version}?`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/legal/${selected.id}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Delete failed')
      setFeedback('Draft deleted')
      setSelectedId(null)
      await loadVersions()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Legal</p>
        <h1 className="text-2xl font-headline font-bold text-on-surface">Legal Documents</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Manage versioned Terms of Service and Privacy Policy documents, publish them, and audit user acceptances.
        </p>
      </div>

      {/* Doc-type tabs */}
      <div className="flex gap-2">
        {DOC_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setDocType(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
              docType === t.key
                ? 'border-[var(--color-accent-v2)] text-on-surface bg-[var(--color-surface-container)]'
                : 'border-[var(--color-card-border)] text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {feedback && (
        <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-400">{feedback}</div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Version list */}
        <div className="lg:col-span-2 pib-card space-y-2">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Versions</p>
            <button
              type="button"
              disabled={busy}
              onClick={createDraft}
              className="text-xs font-medium px-2.5 py-1 rounded-md border border-[var(--color-card-border)] text-on-surface hover:bg-[var(--color-surface-container)] disabled:opacity-50"
            >
              + New draft
            </button>
          </div>
          {loading ? (
            <p className="text-sm text-on-surface-variant">Loading…</p>
          ) : versions.length === 0 ? (
            <p className="text-sm text-on-surface-variant">No versions yet. Create a draft to begin.</p>
          ) : (
            versions.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelectedId(v.id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedId === v.id
                    ? 'border-[var(--color-accent-v2)] bg-[var(--color-surface-container)]'
                    : 'border-[var(--color-card-border)] hover:bg-[var(--color-row-hover)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-on-surface">v{v.version}</span>
                  <StatusBadge status={v.status} />
                </div>
                <p className="text-xs text-on-surface-variant mt-1 truncate">{v.title}</p>
                {v.effectiveDate && (
                  <p className="text-[11px] text-on-surface-variant/70 mt-0.5">
                    Effective {String(v.effectiveDate).slice(0, 10)}
                  </p>
                )}
              </button>
            ))
          )}
        </div>

        {/* Editor */}
        <div className="lg:col-span-3 pib-card space-y-3">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Editor</p>
          {!selected ? (
            <p className="text-sm text-on-surface-variant">Select a version, or create a new draft.</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-on-surface">
                  v{selected.version} <StatusBadge status={selected.status} />
                </span>
              </div>
              <label className="block">
                <span className="text-xs text-on-surface-variant">Title</span>
                <input
                  type="text"
                  value={editTitle}
                  disabled={selected.status !== 'draft' || busy}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-on-surface disabled:opacity-60"
                />
              </label>
              <label className="block">
                <span className="text-xs text-on-surface-variant">Body (markdown / HTML)</span>
                <textarea
                  value={editBody}
                  disabled={selected.status !== 'draft' || busy}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={14}
                  className="mt-1 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-on-surface font-mono disabled:opacity-60"
                />
              </label>
              <label className="block">
                <span className="text-xs text-on-surface-variant">Effective date</span>
                <input
                  type="date"
                  value={editEffective}
                  disabled={busy}
                  onChange={(e) => setEditEffective(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-on-surface"
                />
              </label>
              <div className="flex flex-wrap gap-2 pt-2">
                {selected.status === 'draft' && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={saveDraft}
                      className="text-sm font-medium px-3 py-1.5 rounded-lg border border-[var(--color-card-border)] text-on-surface hover:bg-[var(--color-surface-container)] disabled:opacity-50"
                    >
                      Save draft
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={publish}
                      className="text-sm font-medium px-3 py-1.5 rounded-lg text-white disabled:opacity-50"
                      style={{ background: 'var(--color-accent-v2)' }}
                    >
                      Publish
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={deleteDraft}
                      className="text-sm font-medium px-3 py-1.5 rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </>
                )}
                {selected.status !== 'draft' && (
                  <p className="text-xs text-on-surface-variant">
                    {selected.status === 'published'
                      ? 'Published versions are read-only. Create a new draft to make changes.'
                      : 'Archived version (read-only).'}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Acceptance log */}
      <div className="pib-card space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Acceptance log</p>
          <a
            href={`/api/v1/admin/legal/acceptances?docType=${encodeURIComponent(docType)}&format=csv`}
            className="text-xs font-medium px-2.5 py-1 rounded-md border border-[var(--color-card-border)] text-on-surface hover:bg-[var(--color-surface-container)]"
          >
            Download CSV
          </a>
        </div>
        {acceptLoading ? (
          <p className="text-sm text-on-surface-variant">Loading acceptances…</p>
        ) : acceptances.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No acceptance records for this document type yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--color-card-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--color-surface-container)] text-left">
                  {['User', 'Org', 'Version', 'Accepted', 'IP'].map((h) => (
                    <th key={h} className="px-3 py-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {acceptances.map((a) => (
                  <tr key={a.id} className="border-t border-[var(--color-card-border)]">
                    <td className="px-3 py-2 text-on-surface">{a.userEmail || a.userId || '—'}</td>
                    <td className="px-3 py-2 text-on-surface-variant">{a.orgId || '—'}</td>
                    <td className="px-3 py-2 text-on-surface-variant">v{a.version ?? '—'}</td>
                    <td className="px-3 py-2 text-on-surface-variant">{a.acceptedAt ? String(a.acceptedAt).slice(0, 19).replace('T', ' ') : '—'}</td>
                    <td className="px-3 py-2 text-on-surface-variant font-mono text-xs">{a.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
