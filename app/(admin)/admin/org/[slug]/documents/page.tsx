'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { OrgThemedFrame } from '@/components/admin/OrgThemedFrame'
import { DocumentIndex } from '@/components/client-documents/DocumentIndex'
import type { ClientDocument, ClientDocumentStatus } from '@/lib/client-documents/types'

const STATUS_TABS: Array<{ label: string; value: ClientDocumentStatus | 'all' }> = [
  { label: 'All', value: 'all' },
  { label: 'Drafts', value: 'internal_draft' },
  { label: 'Internal Review', value: 'internal_review' },
  { label: 'Client Review', value: 'client_review' },
  { label: 'Changes', value: 'changes_requested' },
  { label: 'Approved', value: 'approved' },
  { label: 'Accepted', value: 'accepted' },
  { label: 'Archived', value: 'archived' },
]

export default function OrgDocumentsPage() {
  const params = useParams<{ slug: string }>()
  const slug = params.slug
  const search = useSearchParams()
  const activeStatus = (search.get('status') ?? 'all') as ClientDocumentStatus | 'all'

  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [documents, setDocuments] = useState<ClientDocument[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/organizations')
      .then((r) => r.json())
      .then((body) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const org = (body.data ?? []).find((o: any) => o.slug === slug)
        if (org) {
          setOrgId(org.id)
          setOrgName(org.name)
        } else {
          setLoading(false)
        }
      })
      .catch(() => setLoading(false))
  }, [slug])

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    fetch(`/api/v1/client-documents?orgId=${orgId}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        setDocuments(body.data ?? [])
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  const filtered =
    activeStatus === 'all' ? documents : documents.filter((d) => d.status === activeStatus)

  return (
    <OrgThemedFrame orgId={orgId} className="-m-6 min-h-screen p-6">
      <div className="space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">{orgName || 'Client workspace'}</p>
            <h1 className="pib-page-title mt-2">Client Documents</h1>
            <p className="pib-page-sub mt-2 max-w-2xl">
              Proposals, specs, strategies, and reports for this client. Use the tabs to move between the active review states.
            </p>
          </div>
          <Link
            href={`/admin/org/${slug}/documents/new`}
            className="btn-pib-accent"
          >
            <span className="material-symbols-outlined text-base">add</span>
            New Document
          </Link>
        </header>

        <nav className="bento-card !p-2 flex gap-2 overflow-x-auto" aria-label="Document status filters">
          {STATUS_TABS.map((tab) => {
            const count =
              tab.value === 'all'
                ? documents.length
                : documents.filter((d) => d.status === tab.value).length
            const isActive = activeStatus === tab.value
            const href =
              tab.value === 'all'
                ? `/admin/org/${slug}/documents`
                : `/admin/org/${slug}/documents?status=${tab.value}`
            return (
              <Link
                key={tab.value}
                href={href}
                className={`inline-flex whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[var(--color-pib-accent)] text-black'
                    : 'text-[var(--color-pib-text-muted)] hover:bg-[var(--color-surface)] hover:text-on-surface'
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                    isActive ? 'bg-black/15 text-black' : 'bg-[var(--color-surface-variant)] text-on-surface'
                  }`}>
                    {count}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="pib-skeleton h-16" />
            ))}
          </div>
        ) : (
          <DocumentIndex
            documents={filtered}
            basePath={`/admin/org/${slug}/documents`}
            canDelete
            onDeleted={(documentId) => setDocuments((current) => current.filter((doc) => doc.id !== documentId))}
          />
        )}
      </div>
    </OrgThemedFrame>
  )
}
