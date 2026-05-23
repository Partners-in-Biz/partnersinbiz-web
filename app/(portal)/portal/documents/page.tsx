'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { ClientDocument, ClientDocumentStatus, ClientDocumentType } from '@/lib/client-documents/types'

const CLIENT_STATUSES: ClientDocumentStatus[] = ['client_review', 'changes_requested', 'approved', 'accepted']

const TYPE_LABELS: Record<ClientDocumentType, string> = {
  sales_proposal: 'Sales Proposal',
  build_spec: 'Build Spec',
  social_strategy: 'Social Strategy',
  content_campaign_plan: 'Content Campaign Plan',
  geo_seo_strategy: 'GEO SEO Agent Workflow',
  research_report: 'Research Report',
  monthly_report: 'Monthly Report',
  launch_signoff: 'Launch Sign-off',
  change_request: 'Change Request',
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

const STATUS_LABEL: Record<ClientDocumentStatus, string> = {
  internal_draft: 'Draft',
  internal_review: 'Internal review',
  client_review: 'Awaiting your review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  accepted: 'Accepted',
  archived: 'Archived',
}

export default function PortalDocuments() {
  const [docs, setDocs] = useState<ClientDocument[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/client-documents')
      .then((r) => r.json())
      .then((b: { data?: ClientDocument[] }) => {
        const all = b.data ?? []
        setDocs(all.filter((d) => CLIENT_STATUSES.includes(d.status)))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-10">
      <header>
        <p className="eyebrow">Documents</p>
        <h1 className="pib-page-title mt-2">Your Documents</h1>
        <p className="pib-page-sub max-w-2xl">
          Proposals, specs, strategies, and reports from Partners in Biz.
        </p>
      </header>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="pib-skeleton h-28" />
          ))}
        </div>
      ) : docs.length === 0 ? (
        <div className="bento-card p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">description</span>
          <h2 className="font-display text-2xl mt-4">No documents shared with you yet.</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] max-w-md mx-auto mt-2">
            Documents will appear here when Partners in Biz shares proposals, specs, or reports with you.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {docs.map((doc) => (
            <article key={doc.id} className="bento-card flex flex-col gap-4">
              <div className="flex-1 space-y-2">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
                  {TYPE_LABELS[doc.type] ?? doc.type}
                </p>
                <h2 className="font-display text-lg leading-snug">{doc.title}</h2>
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className={STATUS_PILL[doc.status] ?? 'pib-pill'}>
                  {STATUS_LABEL[doc.status] ?? doc.status}
                </span>
                <Link
                  href={`/portal/documents/${doc.id}`}
                  className="btn-pib-accent !py-1.5 !px-3 !text-sm"
                >
                  View
                  <span className="material-symbols-outlined text-base">arrow_forward</span>
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
