'use client'

import { useState } from 'react'
import { Surface } from '@/components/ui/AppFoundation'
import type { BookProjectMetadata } from './types'

type BookProjectMetadataPanelProps = {
  metadata: BookProjectMetadata
  saving: boolean
  onSave: (metadata: BookProjectMetadata) => void | Promise<void>
}

const fields: Array<{ key: keyof BookProjectMetadata; label: string; type?: 'textarea' }> = [
  { key: 'title', label: 'Title' },
  { key: 'subtitle', label: 'Subtitle' },
  { key: 'authorName', label: 'Author name' },
  { key: 'imprint', label: 'Imprint' },
  { key: 'isbn', label: 'ISBN' },
  { key: 'language', label: 'Language' },
  { key: 'description', label: 'Description', type: 'textarea' },
]

export function BookProjectMetadataPanel({ metadata, saving, onSave }: BookProjectMetadataPanelProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<BookProjectMetadata>(metadata)

  function startEdit() {
    setDraft(metadata)
    setEditing(true)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    await onSave({ ...draft, aiDisclosure: draft.aiDisclosure ?? '' })
    setEditing(false)
  }

  if (!editing) {
    return (
      <Surface
        header={<h2 className="text-lg">Metadata</h2>}
        footer={
          <button type="button" className="btn-secondary" onClick={startEdit}>
            Edit metadata
          </button>
        }
      >
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">Title</dt>
            <dd className="text-sm text-[var(--color-pib-text)]">{metadata.title || ' - '}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">Subtitle</dt>
            <dd className="text-sm text-[var(--color-pib-text)]">{metadata.subtitle || ' - '}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">Author</dt>
            <dd className="text-sm text-[var(--color-pib-text)]">{metadata.authorName || ' - '}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">Imprint</dt>
            <dd className="text-sm text-[var(--color-pib-text)]">{metadata.imprint || ' - '}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">ISBN</dt>
            <dd className="text-sm text-[var(--color-pib-text)]">{metadata.isbn || ' - '}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">Language</dt>
            <dd className="text-sm text-[var(--color-pib-text)]">{metadata.language || ' - '}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">Description</dt>
            <dd className="text-sm text-[var(--color-pib-text)]">{metadata.description || ' - '}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">AI disclosure</dt>
            <dd className="text-sm text-[var(--color-pib-text)]">{metadata.aiDisclosure ? 'Disclosed' : 'Not disclosed'}</dd>
          </div>
        </dl>
      </Surface>
    )
  }

  return (
    <Surface header={<h2 className="text-lg">Edit metadata</h2>}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <label key={field.key} className={field.type === 'textarea' ? 'sm:col-span-2 space-y-1' : 'space-y-1'}>
              <span className="text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">{field.label}</span>
              {field.type === 'textarea' ? (
                <textarea
                  className="input-field w-full"
                  rows={3}
                  value={draft[field.key] ?? ''}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
                 aria-label="Input"/>
              ) : (
                <input
                  className="input-field w-full"
                  value={draft[field.key] ?? ''}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
                 aria-label="Input"/>
              )}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--color-pib-text)]">
          <input
            type="checkbox"
            checked={Boolean(draft.aiDisclosure)}
            onChange={(event) => setDraft((prev) => ({ ...prev, aiDisclosure: event.target.checked ? 'AI-assisted content' : '' }))}
           aria-label="Toggle"/>
          AI disclosure required
        </label>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save metadata'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setEditing(false)} disabled={saving}>
            Cancel
          </button>
        </div>
      </form>
    </Surface>
  )
}
