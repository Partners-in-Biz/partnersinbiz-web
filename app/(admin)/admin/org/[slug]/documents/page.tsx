'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { OrgThemedFrame } from '@/components/admin/OrgThemedFrame'
import { PageHeader } from '@/components/ui/AppFoundation'
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
        <PageHeader
          eyebrow={orgName || 'Client workspace'}
          title="Client Documents"
          description="Proposals, specs, strategies, and reports for this client. Use the tabs to move between active review states."
          actions={(
            <Link
              href={`/admin/org/${slug}/documents/new`}
              className="btn-pib-accent"
            >
              <span className="material-symbols-outlined text-base">add</span>
              New Document
            </Link>
          )}
        />

        <nav className="pib-tabs" aria-label="Document status filters">
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
                className={`pib-tab ${isActive ? 'pib-tab-active' : ''}`}
              >
                {tab.label}
                {count > 0 && (
                  <span className="pib-tabs-badge">
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
