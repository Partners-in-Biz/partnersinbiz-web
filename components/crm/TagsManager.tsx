'use client'

// US-058 - Tags management. Lists every distinct contact tag with usage counts,
// supports creating zero-usage registry tags, inline rename (rewrites the tag on
// all contacts), and delete-with-confirmation (strips the tag from all contacts).
// Backed by /api/v1/crm/tags + /api/v1/crm/tags/[tag].

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@/components/studio'

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
    <div className="flex min-h-0 flex-col gap-2">
      {/* Create */}
      <form onSubmit={createTag} className="space-y-2 rounded-[var(--st-radius-raised)] border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-3">
        <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Create tag</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1 flex-1 min-w-[12rem]">
            <label htmlFor="crm-new-tag" className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">
              Tag name
            </label>
            <input
              id="crm-new-tag"
              aria-label="Tag name"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="vip"
              maxLength={64}
              className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-[var(--color-pib-text)] outline-none transition focus:border-[var(--color-accent-v2)]"
            />
          </div>
          <button type="submit" disabled={creating} className="flex h-8 items-center gap-1.5 rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition disabled:opacity-40">
            <Icon name="add" />
            {creating ? 'Adding…' : 'Add tag'}
          </button>
        </div>
        {createError && (
          <p className="text-[11px] text-red-300">
            {createError}
          </p>
        )}
        <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">
          Created tags appear here with zero usage until applied to contacts.
        </p>
      </form>

      {/* Delete confirmation */}
      {pendingDelete && (
        <section
          role="alertdialog"
          aria-modal="false"
          className="rounded-[var(--st-radius-raised)] border border-red-400/40 bg-red-400/10 p-3"
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-2.5">
              <Icon name="warning" className="mt-0.5 text-red-200" />
              <div>
                <p className="text-[10px] font-label uppercase tracking-[0.22em] text-red-100/80">Tag delete</p>
                <h2 className="mt-1 text-sm text-red-50">
                  Delete tag &quot;{pendingDelete.tag}&quot;?
                </h2>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-red-100/90">
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
                className="flex h-8 items-center rounded-md border border-[var(--color-card-border)] px-3 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-red-400/40 bg-red-400/10 px-3 text-xs font-medium text-red-100 transition hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Icon name="delete" />
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
            <div key={i} className="pib-skeleton h-10" />
          ))}
        </div>
      ) : loadError ? (
        <section className="rounded-[var(--st-radius-raised)] border border-[var(--sc-line-strong)] bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-2.5">
              <Icon name="warning" className="mt-0.5 text-[var(--st-warning)]" />
              <div>
                <h2 className="text-sm text-[var(--color-pib-text)]">Tags could not load</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">{loadError}</p>
              </div>
            </div>
            <button type="button" onClick={fetchTags} className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-3 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]">
              <Icon name="refresh" />
              Retry
            </button>
          </div>
        </section>
      ) : tags.length === 0 ? (
        <div className="rounded-[var(--st-radius-raised)] border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-4 text-center">
          <Icon name="label" className="text-primary" />
          <h2 className="mt-2 text-sm text-[var(--color-pib-text)]">No tags yet.</h2>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
            Tags applied to contacts show up here, or create one above.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--st-radius-raised)] border border-[var(--color-card-border)] bg-[var(--color-card)]/45">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-card-border)] text-left">
                <th className="px-3 py-2 text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Tag</th>
                <th className="px-3 py-2 text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Usage</th>
                <th className="px-3 py-2 text-right text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((row) => {
                const isEditing = editingTag === row.tag
                const err = rowError?.tag === row.tag ? rowError.message : null
                return (
                  <tr key={row.tag} className="border-b border-[var(--color-card-border)] transition hover:bg-white/[0.04] last:border-0">
                    <td className="px-3 py-2 align-middle">
                      {isEditing ? (
                        <input
                          value={editValue}
                          aria-label="Rename tag"
                          onChange={(e) => setEditValue(e.target.value)}
                          maxLength={64}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveRename(row.tag)
                            if (e.key === 'Escape') setEditingTag(null)
                          }}
                          className="h-8 rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-[var(--color-pib-text)] outline-none transition focus:border-[var(--color-accent-v2)]"
                        />
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <span className="pib-pill pib-pill-accent">
                            {row.tag}
                          </span>
                          {row.registered && row.count === 0 && (
                            <span className="text-[10px] text-[var(--color-pib-text-muted)]">unused</span>
                          )}
                        </span>
                      )}
                      {err && (
                        <p className="mt-1 text-[11px] text-red-300">
                          {err}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 align-middle text-[var(--color-pib-text-muted)]">
                      {row.count} contact{row.count === 1 ? '' : 's'}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <div className="flex items-center justify-end gap-1">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => saveRename(row.tag)}
                              disabled={savingRename}
                              className="flex h-8 items-center rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition disabled:opacity-40"
                            >
                              {savingRename ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingTag(null)}
                              className="flex h-8 items-center rounded-md border border-[var(--color-card-border)] px-3 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => startRename(row)}
                              className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
                              aria-label={`Rename tag ${row.tag}`}
                            >
                              <Icon name="edit" />
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDelete(row)}
                              className="grid h-8 w-8 place-items-center rounded-md text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-red-300"
                              aria-label={`Delete tag ${row.tag}`}
                            >
                              <Icon name="delete" />
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
