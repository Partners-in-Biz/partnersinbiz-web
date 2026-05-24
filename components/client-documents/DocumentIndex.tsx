'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import type { ClientDocument, ClientDocumentStatus, ClientDocumentType } from '@/lib/client-documents/types'

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

function readable(value: string) {
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

export function DocumentIndex({
  documents,
  basePath,
  canDelete = false,
  onDeleted,
}: {
  documents: ClientDocument[]
  basePath: string
  canDelete?: boolean
  onDeleted?: (documentId: string) => void
}) {
  const [visibleDocuments, setVisibleDocuments] = useState(documents)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    setVisibleDocuments(documents)
  }, [documents])

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

      setVisibleDocuments((current) => current.filter((item) => item.id !== document.id))
      onDeleted?.(document.id)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete document')
    } finally {
      setDeletingId(null)
    }
  }

  if (visibleDocuments.length === 0) {
    return (
      <div className="bento-card p-10 text-center">
        <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">description</span>
        <h2 className="mt-4 font-display text-2xl">No documents match this view.</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-pib-text-muted)]">
          Change the filter or create a Research Report for evidence, a Website/App Build Spec for what to build, a Change Request for scope changes, or a strategy/report for marketing and performance work.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {deleteError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {deleteError}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visibleDocuments.map((document) => (
          <article key={document.id} className="bento-card flex min-h-[230px] flex-col gap-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-2">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
                  {TYPE_LABELS[document.type] ?? readable(document.type)}
                </p>
                <h2 className="font-display text-xl leading-snug">
                  <Link href={`${basePath}/${document.id}`} className="hover:text-[var(--color-pib-accent)]">
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
                <dd className="mt-1 text-[var(--color-pib-text-muted)]">{linkedLabel(document)}</dd>
              </div>
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
                <Link href={`${basePath}/${document.id}`} className="btn-pib-accent !px-3 !py-1.5 !text-sm">
                  Open
                  <span className="material-symbols-outlined text-base">arrow_forward</span>
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
