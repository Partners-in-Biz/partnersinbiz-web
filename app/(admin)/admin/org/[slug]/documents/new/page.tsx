'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { OrgThemedFrame } from '@/components/admin/OrgThemedFrame'
import { CLIENT_DOCUMENT_TEMPLATES } from '@/lib/client-documents/templates'
import type { ClientDocumentType } from '@/lib/client-documents/types'

const TYPE_OPTIONS: Array<{ value: ClientDocumentType; label: string }> = CLIENT_DOCUMENT_TEMPLATES.map(
  (t) => ({ value: t.type, label: t.label })
)

type OrganizationSummary = { id: string; name?: string; slug?: string }

export default function OrgNewDocumentPage() {
  const router = useRouter()
  const params = useParams<{ slug: string }>()
  const slug = params.slug

  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [title, setTitle] = useState('')
  const [type, setType] = useState<ClientDocumentType>('sales_proposal')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const templateId = CLIENT_DOCUMENT_TEMPLATES.find((t) => t.type === type)?.id ?? ''

  useEffect(() => {
    fetch('/api/v1/organizations')
      .then((r) => r.json())
      .then((body: { data?: OrganizationSummary[] }) => {
        const org = (body.data ?? []).find((o) => o.slug === slug)
        if (org) {
          setOrgId(org.id)
          setOrgName(org.name ?? '')
        }
      })
      .catch(() => {})
  }, [slug])

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
      router.push(`/admin/org/${slug}/documents/${doc.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <OrgThemedFrame orgId={orgId} className="-m-6 min-h-screen p-6">
      <div className="mx-auto max-w-xl space-y-6">
        <header className="flex items-center gap-3">
          <Link
            href={`/admin/org/${slug}/documents`}
            className="text-xs text-on-surface-variant hover:text-on-surface"
          >
            ← Documents
          </Link>
          {orgName && (
            <p className="text-xs uppercase tracking-[0.18em] text-on-surface-variant">{orgName}</p>
          )}
          <h1 className="text-2xl font-semibold">New Document</h1>
          <p className="text-sm text-on-surface-variant">
            Creates an internal draft for PiB drafting/review. It is not sent to the client, published, or shared until a separate approval/client-review gate is used.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-lg border border-[var(--color-outline)] bg-[var(--color-surface)] p-6"
        >
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
              placeholder="e.g. Sales Proposal Q3 2026"
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
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Template info */}
          {templateId && (
            <p className="text-xs text-on-surface-variant">
              Template: <span className="font-mono">{templateId}</span>
            </p>
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
              href={`/admin/org/${slug}/documents`}
              className="text-sm text-on-surface-variant hover:text-on-surface"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </OrgThemedFrame>
  )
}
