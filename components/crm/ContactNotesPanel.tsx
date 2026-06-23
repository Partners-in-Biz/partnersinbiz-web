'use client'

import { useCallback, useEffect, useState } from 'react'

export interface ContactNote {
  id: string
  body?: string
  authorUid?: string
  authorName?: string
  createdByRef?: { displayName?: string; uid?: string }
  createdAt?: unknown
  updatedAt?: unknown
}

interface ContactNotesPanelProps {
  contactId: string
  contactName?: string
  /** Builds an org-scoped API path (mirrors the contact page's contactApiPath). */
  apiPath: (path: string) => string
  /** Current actor uid — used to gate edit/delete affordances client-side. */
  currentUid?: string
  /** True when the actor is an admin/owner (can edit/delete any note). */
  isPrivileged?: boolean
}

function noteAuthorLabel(note: ContactNote): string {
  const ref = note.createdByRef?.displayName?.trim()
  if (ref) return ref
  const author = note.authorName?.trim()
  if (author) return author
  return 'Author identity missing'
}

function relativeTime(value: unknown): string {
  const ms = millis(value)
  if (!ms) return 'Time not captured'
  const diff = Date.now() - ms
  const abs = Math.abs(diff)
  const mins = Math.floor(abs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ms).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

function millis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const c = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof c.toMillis === 'function') return c.toMillis()
    if (typeof c.toDate === 'function') return c.toDate().getTime()
    if (typeof c.seconds === 'number') return c.seconds * 1000
    if (typeof c._seconds === 'number') return c._seconds * 1000
  }
  return 0
}

export function ContactNotesPanel({
  contactId,
  contactName,
  apiPath,
  currentUid,
  isPrivileged = false,
}: ContactNotesPanelProps) {
  const label = contactName?.trim() || 'this contact'
  const [notes, setNotes] = useState<ContactNote[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [rowError, setRowError] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const loadNotes = useCallback(async () => {
    if (!contactId) return
    setLoading(true)
    setLoadError('')
    try {
      const r = await fetch(apiPath(`/api/v1/crm/contacts/${contactId}/notes`))
      const b = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(typeof b?.error === 'string' ? b.error : `HTTP ${r.status}`)
      const list = (b.data?.notes ?? b.notes ?? []) as ContactNote[]
      setNotes(list)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Notes failed to load.')
    } finally {
      setLoading(false)
    }
  }, [apiPath, contactId])

  useEffect(() => {
    void loadNotes()
  }, [loadNotes])

  function canMutate(note: ContactNote): boolean {
    if (isPrivileged) return true
    return Boolean(currentUid) && note.authorUid === currentUid
  }

  async function addNote() {
    const body = draft.trim()
    if (!body) return
    setSaving(true)
    setSaveError('')
    try {
      const r = await fetch(apiPath(`/api/v1/crm/contacts/${contactId}/notes`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(typeof b?.error === 'string' ? b.error : 'Failed to add note')
      const note = (b.data?.note ?? b.note) as ContactNote | undefined
      if (note) setNotes((prev) => [note, ...prev])
      else await loadNotes()
      setDraft('')
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to add note')
    } finally {
      setSaving(false)
    }
  }

  function startEdit(note: ContactNote) {
    setEditingId(note.id)
    setEditDraft(note.body ?? '')
    setRowError('')
  }

  async function saveEdit(noteId: string) {
    const body = editDraft.trim()
    if (!body) return
    setEditSaving(true)
    setRowError('')
    try {
      const r = await fetch(apiPath(`/api/v1/crm/contacts/${contactId}/notes/${noteId}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(typeof b?.error === 'string' ? b.error : 'Failed to update note')
      const updated = (b.data?.note ?? b.note) as ContactNote | undefined
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, ...(updated ?? { body }) } : n)),
      )
      setEditingId(null)
      setEditDraft('')
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Failed to update note')
    } finally {
      setEditSaving(false)
    }
  }

  async function deleteNote(noteId: string) {
    setRowError('')
    try {
      const r = await fetch(apiPath(`/api/v1/crm/contacts/${contactId}/notes/${noteId}`), {
        method: 'DELETE',
      })
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        throw new Error(typeof b?.error === 'string' ? b.error : 'Failed to delete note')
      }
      setNotes((prev) => prev.filter((n) => n.id !== noteId))
      setPendingDeleteId(null)
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Failed to delete note')
    }
  }

  return (
    <section className="bento-card !p-5" aria-label={`Notes for ${label}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="eyebrow !text-[10px]">Notes</p>
        <span className="text-xs text-[var(--color-pib-text-muted)]">
          {notes.length === 0 ? 'No notes yet' : notes.length === 1 ? '1 note' : `${notes.length} notes`}
        </span>
      </div>

      {/* Composer */}
      <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-3">
        <label htmlFor="contact-note-composer" className="sr-only">
          {`Add a note for ${label}`}
        </label>
        <textarea
          id="contact-note-composer"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder={`Add a relationship note, handoff, or context for ${label}…`}
          className="input-pib w-full resize-y text-sm"
          aria-label={`Add a note for ${label}`}
        />
        {saveError && <p className="mt-2 text-xs text-red-400">{saveError}</p>}
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={addNote}
            disabled={saving || !draft.trim()}
            aria-label={`Save note for ${label}`}
            className="btn-pib-primary inline-flex items-center gap-1.5 text-xs disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">add_comment</span>
            {saving ? 'Saving…' : 'Add note'}
          </button>
        </div>
      </div>

      {rowError && <p className="mt-3 text-xs text-red-400">{rowError}</p>}

      {/* List */}
      <div className="mt-4">
        {loading ? (
          <div className="space-y-3" role="status" aria-label="Loading notes">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="pib-skeleton h-12 rounded-lg" />
            ))}
          </div>
        ) : loadError ? (
          <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.07] p-3">
            <p className="text-sm text-[var(--color-pib-text-muted)]">{loadError}</p>
            <button
              type="button"
              onClick={() => void loadNotes()}
              className="btn-pib-secondary mt-2 inline-flex items-center gap-1.5 text-xs"
              aria-label="Retry loading notes"
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">refresh</span>
              Retry
            </button>
          </div>
        ) : notes.length === 0 ? (
          <p className="text-sm leading-6 text-[var(--color-pib-text-muted)]">
            No notes captured yet. Use the field above to record context the whole team can see.
          </p>
        ) : (
          <ul className="space-y-3">
            {notes.map((note) => {
              const mutable = canMutate(note)
              const isEditing = editingId === note.id
              const isPendingDelete = pendingDeleteId === note.id
              return (
                <li
                  key={note.id}
                  className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs text-[var(--color-pib-text-muted)]">
                      <span className="font-medium text-[var(--color-pib-text)]">{noteAuthorLabel(note)}</span>
                      {' · '}
                      {relativeTime(note.updatedAt || note.createdAt)}
                    </p>
                    {mutable && !isEditing && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(note)}
                          aria-label={`Edit note by ${noteAuthorLabel(note)}`}
                          className="inline-flex items-center rounded-md border border-[var(--color-pib-line)] px-1.5 py-1 text-[11px] text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)]"
                        >
                          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(note.id)}
                          aria-label={`Delete note by ${noteAuthorLabel(note)}`}
                          className="inline-flex items-center rounded-md border border-[var(--color-pib-line)] px-1.5 py-1 text-[11px] text-[var(--color-pib-text-muted)] transition-colors hover:text-red-400"
                        >
                          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">delete</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="mt-2">
                      <label htmlFor={`edit-note-${note.id}`} className="sr-only">Edit note</label>
                      <textarea
                        id={`edit-note-${note.id}`}
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={3}
                        className="input-pib w-full resize-y text-sm"
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => { setEditingId(null); setEditDraft('') }}
                          className="btn-pib-secondary text-xs"
                          aria-label="Cancel note edit"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => saveEdit(note.id)}
                          disabled={editSaving || !editDraft.trim()}
                          className="btn-pib-primary text-xs disabled:opacity-50"
                          aria-label="Save note edit"
                        >
                          {editSaving ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-[var(--color-pib-text)]">
                      {note.body?.trim() || 'Empty note'}
                    </p>
                  )}

                  {isPendingDelete && (
                    <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-red-400/25 bg-red-400/[0.06] p-2">
                      <span className="text-xs text-[var(--color-pib-text-muted)]">Delete this note?</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(null)}
                          className="btn-pib-secondary text-[11px]"
                          aria-label="Keep note"
                        >
                          Keep
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteNote(note.id)}
                          className="inline-flex items-center gap-1 rounded-md bg-red-500/90 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-500"
                          aria-label="Confirm delete note"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
