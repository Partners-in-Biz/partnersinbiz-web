'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CLIENT_DOCUMENT_TEMPLATES } from '@/lib/client-documents/templates'
import type { ClientDocumentType } from '@/lib/client-documents/types'
import {
  canRolePerformModuleAction,
  resolveOrganizationModulePolicies,
} from '@/lib/organizations/module-policies'

const TYPE_OPTIONS = CLIENT_DOCUMENT_TEMPLATES.map((template) => ({
  value: template.type,
  label: template.label,
  description: template.picker.description,
}))

function initialDocumentQuery() {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function canCreateDocumentFromPortalBody(body: Record<string, unknown>) {
  const org = isRecord(body.org) ? body.org : isRecord(body.data) && isRecord(body.data.org) ? body.data.org : {}
  const user = isRecord(body.user) ? body.user : isRecord(body.data) && isRecord(body.data.user) ? body.data.user : {}
  const policies = resolveOrganizationModulePolicies({ modulePolicies: org.modulePolicies })
  const role = user.memberRole ?? user.role
  return canRolePerformModuleAction(policies, 'documents', 'create', role)
}

export default function PortalNewDocumentPage() {
  const router = useRouter()
  const searchParams = initialDocumentQuery()

  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [title, setTitle] = useState(searchParams.get('title') ?? '')
  const initialType = searchParams.get('type')
  const [type, setType] = useState<ClientDocumentType>(
    TYPE_OPTIONS.some(option => option.value === initialType) ? initialType as ClientDocumentType : 'sales_proposal'
  )
  const [submitting, setSubmitting] = useState(false)
  const [canCreateDocument, setCanCreateDocument] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const selectedTemplate = CLIENT_DOCUMENT_TEMPLATES.find((t) => t.type === type)
  const templateId = selectedTemplate?.id ?? ''

  useEffect(() => {
    fetch('/api/v1/portal/org')
      .then((r) => r.json())
      .then((body) => {
        const org = body?.org ?? body?.data?.org ?? null
        if (org?.id) {
          setOrgId(org.id)
          setOrgName(typeof org.name === 'string' ? org.name : '')
        }
        if (body && typeof body === 'object' && !Array.isArray(body)) {
          setCanCreateDocument(canCreateDocumentFromPortalBody(body as Record<string, unknown>))
        }
      })
      .catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId || !title.trim()) return
    if (!canCreateDocument) {
      setError('Document creation is disabled for your organisation role.')
      return
    }
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
      router.push(`/portal/documents/${doc.id}`)
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
          href="/portal/documents"
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
        {/* Workspace org (resolved from the active portal organisation) */}
        <div className="space-y-1.5">
          <p className="block text-sm font-medium">Organisation</p>
          <p className="w-full rounded border border-[var(--color-outline)] bg-[var(--color-surface-variant)] px-3 py-2 text-sm text-on-surface-variant">
            {orgName || 'Loading…'}
          </p>
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
            disabled={!canCreateDocument}
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
            disabled={!canCreateDocument}
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
        {!canCreateDocument && !error && (
          <p className="rounded border border-[var(--color-outline)] bg-[var(--color-surface-variant)] px-3 py-2 text-sm text-on-surface-variant">
            Document creation is disabled for your organisation role.
          </p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={submitting || !orgId || !title.trim() || !canCreateDocument}
            className="btn-primary rounded px-5 py-2 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create document'}
          </button>
          <Link
            href="/portal/documents"
            className="text-sm text-on-surface-variant hover:text-on-surface"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
