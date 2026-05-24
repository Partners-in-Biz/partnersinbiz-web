'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CLIENT_DOCUMENT_TEMPLATES } from '@/lib/client-documents/templates'
import type { ClientDocumentType } from '@/lib/client-documents/types'

interface OrgOption {
  id: string
  name: string
  slug: string
}

const TYPE_OPTIONS = CLIENT_DOCUMENT_TEMPLATES.map((template) => ({
  value: template.type,
  label: template.label,
  description: template.picker.description,
}))

export default function NewDocumentPage() {
  const router = useRouter()

  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [orgId, setOrgId] = useState('')
  const [title, setTitle] = useState('')
  const [type, setType] = useState<ClientDocumentType>('sales_proposal')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Derive templateId from type
  const selectedTemplate = CLIENT_DOCUMENT_TEMPLATES.find((t) => t.type === type)
  const templateId = selectedTemplate?.id ?? ''

  useEffect(() => {
    fetch('/api/v1/organizations')
      .then((r) => r.json())
      .then((body) => {
        const list: OrgOption[] = (body.data ?? []).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (o: any) => ({ id: o.id, name: o.name, slug: o.slug })
        )
        setOrgs(list)
        if (list.length > 0 && !orgId) setOrgId(list[0].id)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId || !title.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/client-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, title: title.trim(), type, templateId }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? body.message ?? `Error ${res.status}`)
        return
      }
      const doc = body.data ?? body
      router.push(`/admin/documents/${doc.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="space-y-2">
        <Link
          href="/admin/documents"
          className="text-xs text-on-surface-variant hover:text-on-surface"
        >
          ← Documents
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">New Document</h1>
          <p className="mt-2 text-sm text-on-surface-variant">
            Pick the document by decision type: research decides what is true; specs decide what to build.
          </p>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-[var(--color-outline)] bg-[var(--color-surface)] p-6">
        {/* Org selector */}
        <div className="space-y-1.5">
          <label htmlFor="orgId" className="block text-sm font-medium">
            Organisation
          </label>
          <select
            id="orgId"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            required
            className="w-full rounded border border-[var(--color-outline)] bg-[var(--color-surface-variant)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
          >
            {orgs.length === 0 && <option value="">Loading…</option>}
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>

        {/* Title */}
        <div className="space-y-1.5">
          <label htmlFor="title" className="block text-sm font-medium">
            Title
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Acme Corp — Sales Proposal Q3 2026"
            required
            className="w-full rounded border border-[var(--color-outline)] bg-[var(--color-surface-variant)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
          />
        </div>

        {/* Type */}
        <div className="space-y-1.5">
          <label htmlFor="type" className="block text-sm font-medium">
            Document type
          </label>
          <select
            id="type"
            value={type}
            onChange={(e) => setType(e.target.value as ClientDocumentType)}
            className="w-full rounded border border-[var(--color-outline)] bg-[var(--color-surface-variant)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} — {o.description}
              </option>
            ))}
          </select>
        </div>

        {selectedTemplate && (
          <section className="rounded-lg border border-[var(--color-outline)] bg-[var(--color-surface-variant)] p-4 text-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-on-surface-variant">Selected template</p>
                <h2 className="mt-1 font-medium text-on-surface">{selectedTemplate.label}</h2>
              </div>
              <span className="rounded-full border border-[var(--color-outline)] px-2 py-1 font-mono text-[11px] text-on-surface-variant">
                {templateId}
              </span>
            </div>
            <p className="mt-3 text-on-surface-variant">{selectedTemplate.picker.description}</p>
            <dl className="mt-4 space-y-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-[0.14em] text-on-surface-variant">Best for</dt>
                <dd className="mt-1 text-on-surface">{selectedTemplate.picker.bestFor}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-[0.14em] text-on-surface-variant">Decision it supports</dt>
                <dd className="mt-1 text-on-surface">{selectedTemplate.picker.decides}</dd>
              </div>
            </dl>
            <p className="mt-4 rounded-md bg-black/10 px-3 py-2 text-xs text-on-surface-variant">
              {selectedTemplate.picker.helpText}
            </p>
          </section>
        )}

        {error && (
          <p className="rounded bg-red-900/30 px-3 py-2 text-sm text-red-400">{error}</p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={submitting || !orgId || !title.trim()}
            className="btn-primary rounded px-5 py-2 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create document'}
          </button>
          <Link
            href="/admin/documents"
            className="text-sm text-on-surface-variant hover:text-on-surface"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
