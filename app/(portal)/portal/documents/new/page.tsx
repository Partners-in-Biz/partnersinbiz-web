'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Icon } from '@/components/studio'
import { CLIENT_DOCUMENT_TEMPLATES } from '@/lib/client-documents/templates'
import type { ClientDocumentType, UserDocumentTemplate } from '@/lib/client-documents/types'
import {
  canRolePerformModuleAction,
  resolveOrganizationModulePolicies,
} from '@/lib/organizations/module-policies'

const TEMPLATE_ICONS: Record<string, string> = {
  sales_proposal: 'handshake',
  build_spec: 'code',
  social_strategy: 'campaign',
  content_campaign_plan: 'calendar_month',
  geo_seo_strategy: 'travel_explore',
  research_report: 'lab_research',
  monthly_report: 'bar_chart',
  launch_signoff: 'rocket_launch',
  change_request: 'edit_document',
}

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

type SavedTemplate = UserDocumentTemplate & { id: string }

export default function PortalNewDocumentPage() {
  const router = useRouter()
  const searchParams = initialDocumentQuery()
  const templateId = searchParams.get('templateId')

  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [title, setTitle] = useState(searchParams.get('title') ?? '')
  const initialType = searchParams.get('type')
  const [type, setType] = useState<ClientDocumentType | null>(
    CLIENT_DOCUMENT_TEMPLATES.some(t => t.type === initialType) ? initialType as ClientDocumentType : null
  )
  const [savedTemplate, setSavedTemplate] = useState<SavedTemplate | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [canCreateDocument, setCanCreateDocument] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const selectedTemplate = CLIENT_DOCUMENT_TEMPLATES.find((t) => t.type === type) ?? null

  // When a saved-template id is present, load it, preselect its type, and keep
  // the full template so we can seed the document's first version after create.
  useEffect(() => {
    if (!templateId) return
    fetch(`/api/v1/client-documents/templates/${templateId}`)
      .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) {
          setError(body?.error ?? 'Could not load the saved template.')
          return
        }
        const tpl = (body?.data ?? body) as SavedTemplate
        if (tpl?.id) {
          setSavedTemplate(tpl)
          setType(tpl.type)
        }
      })
      .catch(() => setError('Could not load the saved template.'))
  }, [templateId])

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
    if (!orgId || !title.trim() || !type) return
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
        body: JSON.stringify({ orgId, title: title.trim(), type }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? body.message ?? `Error ${res.status}`)
        return
      }
      const doc = body.data ?? body

      // If we started from a saved template, seed the new document's first
      // version with the template's blocks + theme.
      if (savedTemplate && Array.isArray(savedTemplate.blocks) && savedTemplate.blocks.length > 0) {
        const seedRes = await fetch(`/api/v1/client-documents/${doc.id}/versions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            blocks: savedTemplate.blocks,
            ...(savedTemplate.theme ? { theme: savedTemplate.theme } : {}),
            changeSummary: `Seeded from saved template: ${savedTemplate.name}`,
          }),
        })
        if (!seedRes.ok) {
          const seedBody = await seedRes.json().catch(() => null)
          setError(seedBody?.error ?? `Document created, but seeding from template failed (${seedRes.status}).`)
          return
        }
      }

      router.push(`/portal/documents/${doc.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  const isDisabled = submitting || !orgId || !title.trim() || !type || !canCreateDocument

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2">
        <Link
          href="/portal/documents"
          className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
        >
          ← Documents
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Documents · New</p>
            <h1 className="pib-page-title mt-2">New Document</h1>
            <p className="pib-page-sub">
              Choose a template, then give your document a title.
            </p>
          </div>
          <Link
            href="/portal/documents/templates"
            className="shrink-0 text-xs font-medium text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
          >
            Manage templates →
          </Link>
        </div>
      </header>

      {savedTemplate && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-pib-accent)]/40 bg-[var(--color-pib-accent)]/8 px-4 py-3 text-sm">
          <Icon name="bookmark" className="text-[18px] text-[var(--color-pib-accent)]" />
          <span>
            Starting from saved template: <span className="">{savedTemplate.name}</span>
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Step 1 - Template picker grid */}
        <section className="space-y-3">
          <h2 className="pib-label">
            Choose a template
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CLIENT_DOCUMENT_TEMPLATES.map((template) => {
              const icon = TEMPLATE_ICONS[template.type] ?? 'description'
              const isSelected = type === template.type
              return (
                <button
                  key={template.type}
                  type="button"
                  disabled={!canCreateDocument}
                  onClick={() => setType(template.type)}
                  className={[
                    'pib-card group relative flex flex-col gap-2 text-left transition-all duration-150',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-pib-accent)]',
                    isSelected
                      ? 'border-[var(--color-pib-accent)]'
                      : 'hover:border-[var(--color-pib-line-strong)]',
                    !canCreateDocument ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                  ].join(' ')}
                  aria-pressed={isSelected}
                >
                  {/* Selected checkmark */}
                  {isSelected && (
                    <span
                      className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center bg-[var(--color-pib-accent)] text-[var(--color-pib-bg)]"
                      aria-hidden="true"
                    >
                      <Icon name="check" className="text-[14px]" />
                    </span>
                  )}

                  {/* Icon */}
                  <Icon name={icon} />

                  {/* Name */}
                  <p className={[
                    'text-sm  leading-snug',
                    isSelected ? 'text-[var(--color-pib-accent)]' : '',
                  ].join(' ')}>
                    {template.label}
                  </p>

                  {/* Description */}
                  <p className="text-xs leading-relaxed text-[var(--color-pib-text-muted)]">
                    {template.picker.description}
                  </p>
                </button>
              )
            })}
          </div>
        </section>

        {/* Selected template detail - shown after pick */}
        {selectedTemplate && (
          <section className="pib-card text-sm">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt className="pib-label">Best for</dt>
                <dd className="mt-1">{selectedTemplate.picker.bestFor}</dd>
              </div>
              <div>
                <dt className="pib-label">Decision it supports</dt>
                <dd className="mt-1">{selectedTemplate.picker.decides}</dd>
              </div>
            </dl>
            <p className="mt-4 border-t border-[var(--color-pib-line)] pt-3 text-xs text-[var(--color-pib-text-muted)]">
              {selectedTemplate.picker.helpText}
            </p>
          </section>
        )}

        {/* Step 2 - Details */}
        <section
          className={[
            'pib-card space-y-4 transition-opacity duration-200',
            !type ? 'pointer-events-none opacity-40' : '',
          ].join(' ')}
        >
          <h2 className="pib-label">
            Document details
          </h2>

          {/* Organisation */}
          <div className="space-y-1.5">
            <p className="pib-label block">Organisation</p>
            <p className="pib-input w-full text-[var(--color-pib-text-muted)]">
              {orgName || 'Loading…'}
            </p>
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <label htmlFor="title" className="pib-label block">
              Title
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={selectedTemplate ? `e.g. ${selectedTemplate.label} - ${orgName || 'Client'} Q3 2026` : 'e.g. Acme Corp - Proposal Q3 2026'}
              required
              disabled={!canCreateDocument || !type}
              className="pib-input w-full"
            />
          </div>
        </section>

        {/* Errors / permission notice */}
        {error && (
          <p className="text-sm text-[var(--color-error)]">{error}</p>
        )}
        {!canCreateDocument && !error && (
          <p className="pib-card text-sm text-[var(--color-pib-text-muted)]">
            Document creation is disabled for your organisation role.
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isDisabled}
            className="btn-pib-primary"
          >
            {submitting ? 'Creating…' : 'Create document'}
          </button>
          <Link
            href="/portal/documents"
            className="btn-pib-ghost"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
