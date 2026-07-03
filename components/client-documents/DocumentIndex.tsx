'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

import type { ClientDocument, ClientDocumentStatus, ClientDocumentType } from '@/lib/client-documents/types'

export interface ClientDocumentPartyLabels {
  creatorCompanyName?: string
  creatorContactName?: string
  recipientCompanyName?: string
  recipientContactName?: string
}

const TYPE_LABELS: Record<ClientDocumentType, string> = {
  sales_proposal: 'Sales Proposal',
  build_spec: 'Website/App Build Spec',
  social_strategy: 'Social Strategy',
  content_campaign_plan: 'Content Campaign Plan',
  geo_seo_strategy: 'GEO / SEO Agent Workflow',
  research_report: 'Research Report',
  monthly_report: 'Monthly Report',
  launch_signoff: 'Launch Sign-off',
  change_request: 'Change Request',
  canvas_draft: 'Canvas Draft',
}

const STATUS_LABELS: Record<ClientDocumentStatus, string> = {
  internal_draft: 'Draft',
  internal_review: 'Internal review',
  client_review: 'Client review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  accepted: 'Accepted',
  archived: 'Archived',
}

const STATUS_PILL: Record<ClientDocumentStatus, string> = {
  internal_draft: 'pib-pill',
  internal_review: 'pib-pill',
  client_review: 'pib-pill pib-pill-info',
  changes_requested: 'pib-pill pib-pill-danger',
  approved: 'pib-pill pib-pill-success',
  accepted: 'pib-pill pib-pill-success',
  archived: 'pib-pill',
}

function readable(value: unknown) {
  if (typeof value !== 'string' || !value) return 'Not set'
  return value.replaceAll('_', ' ')
}

function linkedLabel(document: ClientDocument) {
  const linked = document.linked ?? {}
  const fields = Object.entries(linked)
    .filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0
      return Boolean(value)
    })
    .map(([key]) => key)

  return fields.join(', ') || 'Standalone'
}

function relationshipLabelList(labels?: { companyName?: string; clientOrgName?: string }) {
  return [labels?.companyName, labels?.clientOrgName].filter(Boolean) as string[]
}

interface LinkedResourceLink {
  key: string
  label: string
  href: string
}

type DocumentHrefFor = (document: ClientDocument) => string
type LinkedResourceHrefFor = (
  resource: 'project' | 'research',
  id: string,
  document: ClientDocument,
) => string

function cleanString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function linkedResourceHref(basePath: string, resource: 'project' | 'research', id: string) {
  const encodedId = encodeURIComponent(id)
  if (basePath.startsWith('/portal/')) {
    return resource === 'project' ? `/portal/projects/${encodedId}` : `/portal/research/${encodedId}`
  }

  const scopedAdminMatch = basePath.match(/^\/admin\/org\/([^/]+)\/documents$/)
  if (scopedAdminMatch) {
    const encodedSlug = encodeURIComponent(scopedAdminMatch[1])
    return resource === 'project'
      ? `/admin/org/${encodedSlug}/projects/${encodedId}`
      : `/admin/org/${encodedSlug}/research/${encodedId}`
  }

  if (basePath.startsWith('/admin/')) {
    return resource === 'project' ? `/admin/projects/${encodedId}` : `/admin/research/${encodedId}`
  }

  return ''
}

function linkedResourceLinks(
  document: ClientDocument,
  basePath: string,
  resourceHrefFor?: LinkedResourceHrefFor,
): LinkedResourceLink[] {
  const links: LinkedResourceLink[] = []
  const projectId = cleanString(document.linked?.projectId)
  if (projectId) {
    const href = resourceHrefFor?.('project', projectId, document) || linkedResourceHref(basePath, 'project', projectId)
    if (href) links.push({ key: `project-${projectId}`, label: 'Project', href })
  }

  const researchItemIds = Array.isArray(document.linked?.researchItemIds) ? document.linked.researchItemIds : []
  researchItemIds
    .map(cleanString)
    .filter(Boolean)
    .forEach((researchItemId, index) => {
      const href = resourceHrefFor?.('research', researchItemId, document) || linkedResourceHref(basePath, 'research', researchItemId)
      if (href) {
        links.push({
          key: `research-${researchItemId}`,
          label: researchItemIds.length > 1 ? `Research item ${index + 1}` : 'Research item',
          href,
        })
      }
    })

  return links
}

function hasPartyLabels(labels?: ClientDocumentPartyLabels) {
  return Boolean(
    labels?.creatorCompanyName ||
    labels?.creatorContactName ||
    labels?.recipientCompanyName ||
    labels?.recipientContactName,
  )
}

function formatDate(value: unknown) {
  if (!value || typeof value !== 'string') return 'Not dated'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not dated'
  return new Intl.DateTimeFormat('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

/**
 * Resolve a sortable epoch-millis value from the many timestamp shapes a
 * document can carry: ISO strings, numeric epochs, Firestore-like
 * `{ seconds }` / `{ _seconds }`, or objects exposing `toDate()`.
 */
function toMillis(value: unknown): number {
  if (value == null) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const record = value as {
      seconds?: unknown
      _seconds?: unknown
      toDate?: unknown
    }
    if (typeof record.toDate === 'function') {
      try {
        const date = (record.toDate as () => Date)()
        const time = date instanceof Date ? date.getTime() : NaN
        if (!Number.isNaN(time)) return time
      } catch {
        // fall through to seconds handling
      }
    }
    if (typeof record.seconds === 'number') return record.seconds * 1000
    if (typeof record._seconds === 'number') return record._seconds * 1000
  }
  return 0
}

type SortKey = 'updated' | 'created' | 'title'

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'updated', label: 'Last modified' },
  { value: 'created', label: 'Date created' },
  { value: 'title', label: 'Title (A–Z)' },
]

function isArchived(document: ClientDocument) {
  return document.status === 'archived' || document.deleted === true
}

/** Derive a human "Created by" label from the document's actor metadata. */
function deriveCreatedByLabel(document: ClientDocument): string {
  const createdBy = typeof document.createdBy === 'string' ? document.createdBy.trim() : ''
  if (createdBy.includes('@')) return createdBy
  return document.createdByType === 'agent' ? 'Pip (AI agent)' : 'PiB team'
}

export function DocumentIndex({
  documents,
  basePath,
  hrefFor,
  linkedResourceHrefFor,
  canDelete = false,
  onDeleted,
  relationshipLabels = {},
  partyLabels = {},
  createdByLabels = {},
}: {
  documents: ClientDocument[]
  basePath: string
  hrefFor?: DocumentHrefFor
  linkedResourceHrefFor?: LinkedResourceHrefFor
  canDelete?: boolean
  onDeleted?: (documentId: string) => void
  relationshipLabels?: Record<string, { companyName?: string; clientOrgName?: string }>
  partyLabels?: Record<string, ClientDocumentPartyLabels>
  createdByLabels?: Record<string, string>
}) {
  const [presentDocuments, setPresentDocuments] = useState(documents)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('updated')
  const [showArchived, setShowArchived] = useState(false)

  useEffect(() => {
    setPresentDocuments(documents)
  }, [documents])

  const archivedPresent = useMemo(
    () => presentDocuments.some(isArchived),
    [presentDocuments],
  )

  const visibleDocuments = useMemo(() => {
    const filtered = showArchived
      ? presentDocuments
      : presentDocuments.filter((document) => !isArchived(document))

    const sorted = [...filtered]
    if (sortKey === 'title') {
      sorted.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''))
    } else if (sortKey === 'created') {
      sorted.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
    } else {
      sorted.sort(
        (a, b) =>
          toMillis(b.updatedAt ?? b.createdAt) - toMillis(a.updatedAt ?? a.createdAt),
      )
    }
    return sorted
  }, [presentDocuments, showArchived, sortKey])

  async function deleteDocument(document: ClientDocument) {
    if (deletingId) return

    const confirmed = window.confirm(
      `Delete "${document.title}"? This archives it and removes it from active client document views.`,
    )
    if (!confirmed) return

    setDeletingId(document.id)
    setDeleteError(null)

    try {
      const res = await fetch(`/api/v1/client-documents/${document.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? 'Could not delete document')
      }

      setPresentDocuments((current) => current.filter((item) => item.id !== document.id))
      onDeleted?.(document.id)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete document')
    } finally {
      setDeletingId(null)
    }
  }

  const controlsBar = (
    <div className="bento-card !p-3 flex flex-wrap items-center justify-between gap-3">
      <label className="flex items-center gap-2">
        <span className="eyebrow !text-[9px]">Sort</span>
        <select
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as SortKey)}
          className="pib-select !py-1.5 !text-sm"
          aria-label="Sort documents"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => setShowArchived((current) => !current)}
        aria-pressed={showArchived}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
          showArchived
            ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent)]/15 text-[var(--color-pib-accent)]'
            : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'
        }`}
      >
        <span className="material-symbols-outlined text-base">
          {showArchived ? 'visibility' : 'visibility_off'}
        </span>
        Show archived/trash
      </button>
    </div>
  )

  if (visibleDocuments.length === 0) {
    return (
      <div className="space-y-3">
        {controlsBar}
        {showArchived && !archivedPresent && (
          <p className="text-xs text-[var(--color-pib-text-muted)]">
            No archived or trashed documents are present in this view.
          </p>
        )}
        <div className="bento-card p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">description</span>
          <h2 className="mt-4 font-display text-2xl">No documents match this view.</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-pib-text-muted)]">
            Change the filter or create a Research Report for evidence, a Website/App Build Spec for what to build, a Change Request for scope changes, or a strategy/report for marketing and performance work.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {controlsBar}
      {deleteError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {deleteError}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visibleDocuments.map((document) => {
          const relationshipText = relationshipLabelList(relationshipLabels[document.id])
          const documentHref = hrefFor?.(document) || `${basePath}/${document.id}`
          const resourceLinks = linkedResourceLinks(document, basePath, linkedResourceHrefFor)
          const parties = partyLabels[document.id]
          const createdByLabel = createdByLabels[document.id] || deriveCreatedByLabel(document)
          const archived = isArchived(document)
          return (
            <article key={document.id} className="bento-card flex min-h-[260px] flex-col gap-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <p className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
                    {TYPE_LABELS[document.type] ?? readable(document.type)}
                    {archived && (
                      <span className="pib-pill !text-[9px] !py-0 !px-2 normal-case tracking-normal text-[var(--color-pib-text-muted)]">
                        Archived
                      </span>
                    )}
                  </p>
                  <h2 className="font-display text-xl leading-snug">
                    <Link href={documentHref} className="hover:text-[var(--color-pib-accent)]">
                      {document.title}
                    </Link>
                  </h2>
                </div>
                <span className="material-symbols-outlined shrink-0 text-[var(--color-pib-accent)]">description</span>
              </div>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="eyebrow !text-[9px]">Status</dt>
                  <dd className="mt-1">
                    <span className={STATUS_PILL[document.status] ?? 'pib-pill'}>
                      {STATUS_LABELS[document.status] ?? readable(document.status)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow !text-[9px]">Updated</dt>
                  <dd className="mt-1 text-[var(--color-pib-text-muted)]">
                    {formatDate(document.updatedAt ?? document.createdAt)}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="eyebrow !text-[9px]">Linked</dt>
                  <dd className="mt-1 text-[var(--color-pib-text-muted)]">
                    {relationshipText.length > 0 || resourceLinks.length > 0 ? (
                      <span className="flex flex-wrap gap-1.5">
                        {relationshipText.map((label) => (
                          <span key={label}>{label}</span>
                        ))}
                        {resourceLinks.map((link) => (
                          <Link
                            key={link.key}
                            href={link.href}
                            className="cursor-pointer font-medium text-[var(--color-pib-text-muted)] transition hover:text-[var(--color-pib-accent)] hover:underline"
                          >
                            {link.label}
                          </Link>
                        ))}
                      </span>
                    ) : linkedLabel(document)}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="eyebrow !text-[9px]">Created by</dt>
                  <dd className="mt-1 text-[var(--color-pib-text-muted)]">{createdByLabel}</dd>
                </div>
                {hasPartyLabels(parties) && (
                  <>
                    <div>
                      <dt className="eyebrow !text-[9px]">Prepared by</dt>
                      <dd className="mt-1 leading-snug">
                        {parties?.creatorCompanyName && <span className="block">{parties.creatorCompanyName}</span>}
                        {parties?.creatorContactName && (
                          <span className="block text-[var(--color-pib-text-muted)]">{parties.creatorContactName}</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="eyebrow !text-[9px]">Recipient</dt>
                      <dd className="mt-1 leading-snug">
                        {parties?.recipientCompanyName && <span className="block">{parties.recipientCompanyName}</span>}
                        {parties?.recipientContactName && (
                          <span className="block text-[var(--color-pib-text-muted)]">{parties.recipientContactName}</span>
                        )}
                      </dd>
                    </div>
                  </>
                )}
              </dl>

              <div className="mt-auto flex items-center justify-between gap-3 border-t border-[var(--color-outline)] pt-4">
                <span className="text-xs text-[var(--color-pib-text-muted)]">
                  {document.approvalMode === 'none' ? 'Review document' : readable(document.approvalMode)}
                </span>
                <div className="flex items-center gap-2">
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => deleteDocument(document)}
                      disabled={deletingId === document.id}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-red-500/30 text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`Delete ${document.title}`}
                      title="Delete document"
                    >
                      <span className="material-symbols-outlined text-base">
                        {deletingId === document.id ? 'progress_activity' : 'delete'}
                      </span>
                    </button>
                  )}
                  <Link href={documentHref} className="btn-pib-accent !px-3 !py-1.5 !text-sm">
                    Open
                    <span className="material-symbols-outlined text-base">arrow_forward</span>
                  </Link>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
