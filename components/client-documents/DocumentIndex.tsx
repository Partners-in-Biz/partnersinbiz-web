'use client'

import Link from 'next/link'

import type { ClientDocument, ClientDocumentStatus, ClientDocumentType } from '@/lib/client-documents/types'

const TYPE_LABELS: Record<ClientDocumentType, string> = {
  sales_proposal: 'Sales Proposal',
  build_spec: 'Build Spec',
  social_strategy: 'Social Strategy',
  content_campaign_plan: 'Content Campaign Plan',
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
}: {
  documents: ClientDocument[]
  basePath: string
}) {
  if (documents.length === 0) {
    return (
      <div className="bento-card p-10 text-center">
        <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">description</span>
        <h2 className="mt-4 font-display text-2xl">No documents match this view.</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-pib-text-muted)]">
          Change the filter or create a new client document to start a proposal, spec, strategy, or report.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {documents.map((document) => (
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
            <Link href={`${basePath}/${document.id}`} className="btn-pib-accent !px-3 !py-1.5 !text-sm">
              Open
              <span className="material-symbols-outlined text-base">arrow_forward</span>
            </Link>
          </div>
        </article>
      ))}
    </div>
  )
}
