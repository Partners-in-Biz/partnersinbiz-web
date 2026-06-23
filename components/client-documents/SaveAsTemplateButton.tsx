'use client'

import { useState } from 'react'

export interface SaveAsTemplateButtonProps {
  documentId: string
  orgId?: string
}

export function SaveAsTemplateButton({ documentId, orgId }: SaveAsTemplateButtonProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedName, setSavedName] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/client-documents/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(orgId ? { orgId } : {}),
          documentId,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error ?? `Error ${res.status}`)
        return
      }
      setSavedName(trimmed)
      setName('')
      setDescription('')
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  if (savedName && !open) {
    return (
      <div className="mt-3 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-on-surface-variant">
        <span className="material-symbols-outlined align-middle text-[14px] text-[var(--color-pib-accent)]">
          check_circle
        </span>{' '}
        Saved “{savedName}” as a template.{' '}
        <button
          type="button"
          onClick={() => {
            setSavedName(null)
            setOpen(true)
          }}
          className="underline hover:text-on-surface"
        >
          Save another
        </button>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setError(null)
        }}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-white/10 px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-white/5 hover:text-on-surface"
      >
        <span className="material-symbols-outlined text-[16px]">bookmark_add</span>
        Save as template
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-2 rounded-md border border-white/10 bg-white/5 p-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-on-surface-variant">Save as template</p>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Template name"
        required
        disabled={submitting}
        className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="Description (optional)"
        disabled={submitting}
        className="w-full resize-none rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
      />
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!name.trim() || submitting}
          className="flex-1 rounded-md px-2 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ background: 'var(--color-pib-accent)', color: '#000' }}
        >
          {submitting ? 'Saving…' : 'Save template'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
          disabled={submitting}
          className="rounded-md border border-white/10 px-2 py-1.5 text-xs font-medium hover:bg-white/5 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
