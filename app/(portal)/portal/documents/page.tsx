'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { DocumentIndex, type ClientDocumentPartyLabels } from '@/components/client-documents/DocumentIndex'
import { PageHeader } from '@/components/ui/AppFoundation'
import type { ClientDocument, ClientDocumentStatus } from '@/lib/client-documents/types'

const CLIENT_STATUSES: ClientDocumentStatus[] = ['client_review', 'changes_requested', 'approved', 'accepted']

interface PortalOrgResponse {
  org?: {
    id?: string
    name?: string
  }
}

export default function PortalDocuments() {
  const searchParams = useSearchParams()
  const scopedOrgId = searchParams.get('orgId')?.trim() ?? ''
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

  const partyLabels: Record<string, ClientDocumentPartyLabels> = Object.fromEntries(
    docs.map((doc) => [
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

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="pib-skeleton h-28" />
          ))}
        </div>
      ) : (
        <DocumentIndex documents={docs} basePath="/portal/documents" partyLabels={partyLabels} />
      )}
    </div>
  )
}
