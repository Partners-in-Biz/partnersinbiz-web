'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { DocumentIndex, type ClientDocumentPartyLabels } from '@/components/client-documents/DocumentIndex'
import { PageHeader } from '@/components/ui/AppFoundation'
import type { ClientDocument, ClientDocumentStatus } from '@/lib/client-documents/types'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

const CLIENT_STATUSES: ClientDocumentStatus[] = ['client_review', 'changes_requested', 'approved', 'accepted']

interface PortalOrgResponse {
  org?: {
    id?: string
    name?: string
  }
}

export default function PortalDocuments() {
  const searchParams = useSearchParams()
  const routeScope = scopeFromSearchParams(searchParams)
  const scopedOrgId = routeScope.orgId?.trim() ?? ''
  const statusFilter = (searchParams.get('status') ?? 'all') as ClientDocumentStatus | 'all'
  const query = (searchParams.get('q') ?? '').trim().toLowerCase()
  const [docs, setDocs] = useState<ClientDocument[]>([])
  const [orgName, setOrgName] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadDocuments() {
      try {
        const portalOrgUrl = scopedOrgId
          ? `/api/v1/portal/org?orgId=${encodeURIComponent(scopedOrgId)}`
          : '/api/v1/portal/org'
        const portalOrgRes = await fetch(portalOrgUrl, { cache: 'no-store' })
        const portalOrgBody: PortalOrgResponse | null = portalOrgRes.ok ? await portalOrgRes.json() : null
        const activeOrgId = typeof portalOrgBody?.org?.id === 'string' ? portalOrgBody.org.id : ''
        const activeOrgName = typeof portalOrgBody?.org?.name === 'string' ? portalOrgBody.org.name : ''
        const documentsUrl = activeOrgId
          ? `/api/v1/client-documents?orgId=${encodeURIComponent(activeOrgId)}`
          : '/api/v1/client-documents'
        const res = await fetch(documentsUrl)
        const body: { data?: ClientDocument[] } = res.ok ? await res.json() : {}
        const all = body.data ?? []
        if (!cancelled) {
          setOrgName(activeOrgName)
          setDocs(all.filter((d) => CLIENT_STATUSES.includes(d.status)))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadDocuments().catch(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [scopedOrgId])

  const visibleDocs = docs.filter((doc) => {
    if (statusFilter === 'all' && doc.status === 'archived') return false
    if (statusFilter !== 'all' && doc.status !== statusFilter) return false
    if (!query) return true
    return [doc.title, doc.type, doc.status]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query)
  })

  const partyLabels: Record<string, ClientDocumentPartyLabels> = Object.fromEntries(
    visibleDocs.map((doc) => [
      doc.id,
      {
        creatorCompanyName: 'Partners in Biz',
        creatorContactName: doc.createdByType === 'agent' ? 'Pip' : 'PiB team',
        recipientCompanyName: orgName || 'Client workspace',
        recipientContactName: 'Client team',
      },
    ]),
  )

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Client workspace / Documents"
        title="Your documents"
        description="Proposals, specs, strategies, and reports shared with you by Partners in Biz."
        meta={<span>Client-visible documents only</span>}
      />

      <form className="bento-card !p-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]" action="/portal/documents">
        {routeScope.orgId ? <input type="hidden" name="orgId" value={routeScope.orgId} /> : null}
        {routeScope.orgSlug ? <input type="hidden" name="orgSlug" value={routeScope.orgSlug} /> : null}
        {routeScope.sourceCompanyId ? <input type="hidden" name="sourceCompanyId" value={routeScope.sourceCompanyId} /> : null}
        {routeScope.sourceCompanyName ? <input type="hidden" name="sourceCompanyName" value={routeScope.sourceCompanyName} /> : null}
        <label className="block">
          <span className="eyebrow !text-[9px]">Search</span>
          <input
            name="q"
            defaultValue={searchParams.get('q') ?? ''}
            placeholder="Search title, type, or status..."
            className="pib-input mt-1"
          />
        </label>
        <label className="block">
          <span className="eyebrow !text-[9px]">Status</span>
          <select name="status" defaultValue={statusFilter} className="pib-select mt-1">
            <option value="all">All active documents</option>
            {CLIENT_STATUSES.map((status) => (
              <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn-pib-accent h-10">Apply</button>
          {(statusFilter !== 'all' || query) && (
            <a href={scopedPortalPath('/portal/documents', routeScope)} className="btn-pib-secondary h-10">Clear</a>
          )}
        </div>
      </form>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="pib-skeleton h-28" />
          ))}
        </div>
      ) : (
        <DocumentIndex
          documents={visibleDocs}
          basePath="/portal/documents"
          hrefFor={(document) => scopedPortalPath(`/portal/documents/${encodeURIComponent(document.id)}`, routeScope)}
          linkedResourceHrefFor={(resource, id) => scopedPortalPath(
            resource === 'project'
              ? `/portal/projects/${encodeURIComponent(id)}`
              : `/portal/research/${encodeURIComponent(id)}`,
            routeScope,
          )}
          partyLabels={partyLabels}
        />
      )}
    </div>
  )
}
