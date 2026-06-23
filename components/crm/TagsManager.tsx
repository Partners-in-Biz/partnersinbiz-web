'use client'

// US-058 — Tags management. Lists every distinct contact tag with usage counts,
// supports creating zero-usage registry tags, inline rename (rewrites the tag on
// all contacts), and delete-with-confirmation (strips the tag from all contacts).
// Backed by /api/v1/crm/tags + /api/v1/crm/tags/[tag].

import { useCallback, useEffect, useState } from 'react'

interface TagRow {
  tag: string
  count: number
  registered: boolean
}

interface TagsManagerProps {
  /** Builds an org-scoped API path (scopedApiPath). */
  apiPath: (path: string) => string
}

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return (body as { data: T }).data
  }
  return (body as T) ?? null
}

export function TagsManager({ apiPath }: TagsManagerProps) {
  const [tags, setTags] = useState<TagRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [newTag, setNewTag] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const [editingTag, setEditingTag] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [savingRename, setSavingRename] = useState(false)
  const [rowError, setRowError] = useState<{ tag: string; message: string } | null>(null)

  const [pendingDelete, setPendingDelete] = useState<TagRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchTags = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const res = await fetch(apiPath('/api/v1/crm/tags'))
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : `Failed to load tags (${res.status})`)
      }
      const data = unwrap<{ tags: TagRow[] }>(body)
      setTags(Array.isArray(data?.tags) ? data!.tags : [])
    } catch (err) {
      setTags([])
      setLoadError(err instanceof Error ? err.message : 'Failed to load tags')
    } finally {
      setLoading(false)
    }
  }, [apiPath])

  useEffect(() => {
    fetchTags()
  }, [fetchTags])

  async function createTag(e: React.FormEvent) {
    e.preventDefault()
    const tag = newTag.trim()
    if (!tag) {
      setCreateError('Tag name is required')
      return
    }
    setCreating(true)
    setCreateError('')
    try {
      const res = await fetch(apiPath('/api/v1/crm/tags'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tag }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to create tag')
      }
      setNewTag('')
      await fetchTags()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create tag')
    } finally {
      setCreating(false)
    }
  }

  function startRename(row: TagRow) {
    setEditingTag(row.tag)
    setEditValue(row.tag)
    setRowError(null)
  }

  async function saveRename(originalTag: string) {
    const next = editValue.trim()
    if (!next) {
      setRowError({ tag: originalTag, message: 'Tag name cannot be empty' })
      return
    }
    if (next === originalTag) {
      setEditingTag(null)
      return
    }
    setSavingRename(true)
    setRowError(null)
    try {
      const res = await fetch(apiPath(`/api/v1/crm/tags/${encodeURIComponent(originalTag)}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newTag: next }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Rename failed')
      }
      setEditingTag(null)
      await fetchTags()
    } catch (err) {
      setRowError({ tag: originalTag, message: err instanceof Error ? err.message : 'Rename failed' })
    } finally {
      setSavingRename(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    setRowError(null)
    try {
      const res = await fetch(apiPath(`/api/v1/crm/tags/${encodeURIComponent(pendingDelete.tag)}`), {
        method: 'DELETE',
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Delete failed')
      }
      setPendingDelete(null)
      await fetchTags()
    } catch (err) {
      setRowError({
        tag: pendingDelete.tag,
        message: err instanceof Error ? err.message : 'Delete failed',
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Create */}
      <form onSubmit={createTag} className="bento-card !p-5 space-y-3">
        <p className="eyebrow !text-[10px]">Create tag</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 flex-1 min-w-[12rem]">
            <label className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
              Tag name
            </label>
            <input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="vip"
              maxLength={64}
              className="pib-input"
            />
          </div>
          <button type="submit" disabled={creating} className="btn-pib-accent disabled:opacity-40">
            <span className="material-symbols-outlined text-base" aria-hidden="true">add</span>
            {creating ? 'Adding…' : 'Add tag'}
          </button>
        </div>
        {createError && (
          <p className="text-[11px]" style={{ color: 'var(--color-pib-danger, #FCA5A5)' }}>
            {createError}
          </p>
        )}
        <p className="text-[11px] text-[var(--color-pib-text-muted)]">
          Created tags appear here with zero usage until applied to contacts.
        </p>
      </form>

      {/* Delete confirmation */}
      {pendingDelete && (
        <section
          role="alertdialog"
          aria-modal="false"
          className="rounded-lg border border-red-400/25 bg-red-500/10 p-5"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-3">
              <span className="material-symbols-outlined mt-0.5 text-red-200" aria-hidden="true">warning</span>
              <div>
                <p className="eyebrow !text-[10px] !text-red-100/80">Tag delete</p>
                <h2 className="mt-1 font-display text-lg text-red-50">
                  Delete tag &quot;{pendingDelete.tag}&quot;?
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-red-100/90">
                  This strips &quot;{pendingDelete.tag}&quot; from {pendingDelete.count} contact
                  {pendingDelete.count === 1 ? '' : 's'} and removes it from the tag registry. Contact
                  records themselves are kept.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="btn-pib-secondary text-xs"
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-red-300/30 bg-red-500/20 px-3 py-2 text-xs font-semibold text-red-50 transition-colors hover:border-red-200/60 hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[15px]" aria-hidden="true">delete</span>
                {deleting ? 'Deleting…' : 'Delete tag'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="pib-skeleton h-12" />
          ))}
        </div>
      ) : loadError ? (
        <section className="rounded-[var(--radius-card)] border border-amber-500/25 bg-amber-500/[0.07] p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <span className="material-symbols-outlined mt-0.5 text-amber-200" aria-hidden="true">warning</span>
              <div>
                <h2 className="font-display text-xl text-[var(--color-pib-text)]">Tags could not load</h2>
                <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{loadError}</p>
              </div>
            </div>
            <button type="button" onClick={fetchTags} className="btn-pib-secondary text-sm">
              <span className="material-symbols-outlined text-base" aria-hidden="true">refresh</span>
              Retry
            </button>
          </div>
        </section>
      ) : tags.length === 0 ? (
        <div className="bento-card p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]" aria-hidden="true">label</span>
          <h2 className="font-display text-2xl mt-4">No tags yet.</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-2">
            Tags applied to contacts show up here, or create one above.
          </p>
        </div>
      ) : (
        <div className="bento-card !p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-pib-line)] text-left">
                <th className="px-4 py-3 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Tag</th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Usage</th>
                <th className="px-4 py-3 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((row) => {
                const isEditing = editingTag === row.tag
                const err = rowError?.tag === row.tag ? rowError.message : null
                return (
                  <tr key={row.tag} className="border-b border-[var(--color-pib-line)] last:border-0">
                    <td className="px-4 py-3 align-middle">
                      {isEditing ? (
                        <input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          maxLength={64}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveRename(row.tag)
                            if (e.key === 'Escape') setEditingTag(null)
                          }}
                          className="pib-input !py-1 text-sm"
                        />
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-[11px] font-mono border border-[var(--color-pib-line)] rounded-full px-2 py-0.5 text-[var(--color-pib-text)]">
                            {row.tag}
                          </span>
                          {row.registered && row.count === 0 && (
                            <span className="text-[10px] text-[var(--color-pib-text-muted)]">unused</span>
                          )}
                        </span>
                      )}
                      {err && (
                        <p className="mt-1 text-[11px]" style={{ color: 'var(--color-pib-danger, #FCA5A5)' }}>
                          {err}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 align-middle text-[var(--color-pib-text-muted)]">
                      {row.count} contact{row.count === 1 ? '' : 's'}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex items-center justify-end gap-2">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => saveRename(row.tag)}
                              disabled={savingRename}
                              className="btn-pib-accent !py-1 !px-3 !text-xs disabled:opacity-40"
                            >
                              {savingRename ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingTag(null)}
                              className="btn-pib-secondary !py-1 !px-3 !text-xs"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => startRename(row)}
                              className="btn-pib-secondary !py-1.5 !px-2.5 !text-xs"
                              aria-label={`Rename tag ${row.tag}`}
                            >
                              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">edit</span>
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDelete(row)}
                              className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-danger,#FCA5A5)] transition-colors p-1.5"
                              aria-label={`Delete tag ${row.tag}`}
                            >
                              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">delete</span>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
