'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { OrgThemedFrame } from '@/components/admin/OrgThemedFrame'
import { PageHeader, PageLinkTabs } from '@/components/ui/AppFoundation'
import { DocumentIndex, type ClientDocumentPartyLabels } from '@/components/client-documents/DocumentIndex'
import type { ClientDocument, ClientDocumentStatus } from '@/lib/client-documents/types'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

type ClientDocumentsSurface = 'admin' | 'portal'

interface ClientDocumentsWorkspaceProps {
  surface: ClientDocumentsSurface
  orgSlug?: string
}

interface OrganizationSummary {
  id: string
  name?: string
  slug?: string
}

interface PortalOrgResponse {
  org?: {
    id?: string
    name?: string
  }
}

const ADMIN_STATUS_TABS: Array<{ label: string; value: ClientDocumentStatus | 'all' }> = [
  { label: 'All', value: 'all' },
  { label: 'Drafts', value: 'internal_draft' },
  { label: 'Internal Review', value: 'internal_review' },
  { label: 'Client Review', value: 'client_review' },
  { label: 'Changes', value: 'changes_requested' },
  { label: 'Approved', value: 'approved' },
  { label: 'Accepted', value: 'accepted' },
  { label: 'Archived', value: 'archived' },
]

const CLIENT_STATUSES: ClientDocumentStatus[] = ['client_review', 'changes_requested', 'approved', 'accepted']

function statusLabel(status: ClientDocumentStatus) {
  return status.replaceAll('_', ' ')
}

function orgDocumentPath(orgSlug: string, suffix = '') {
  return `/admin/org/${encodeURIComponent(orgSlug)}/documents${suffix}`
}

function clearAdminDocumentsPath(orgSlug: string, activeStatus: ClientDocumentStatus | 'all') {
  return activeStatus === 'all'
    ? orgDocumentPath(orgSlug)
    : orgDocumentPath(orgSlug, `?status=${encodeURIComponent(activeStatus)}`)
}

export function ClientDocumentsWorkspace({ surface, orgSlug = '' }: ClientDocumentsWorkspaceProps) {
  const searchParams = useSearchParams()
  const routeScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const scopedOrgId = routeScope.orgId?.trim() ?? ''
  const activeStatus = (searchParams.get('status') ?? 'all') as ClientDocumentStatus | 'all'
  const activeType = surface === 'admin' ? searchParams.get('type') ?? 'all' : 'all'
  const query = (searchParams.get('q') ?? '').trim().toLowerCase()

  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [documents, setDocuments] = useState<ClientDocument[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadAdminDocuments() {
      const orgsRes = await fetch('/api/v1/organizations')
      const orgsBody: { data?: OrganizationSummary[] } = orgsRes.ok ? await orgsRes.json() : {}
      const org = (orgsBody.data ?? []).find((item) => item.slug === orgSlug)
      if (!org) {
        if (!cancelled) {
          setOrgId(null)
          setOrgName('')
          setDocuments([])
        }
        return
      }

      const docsRes = await fetch(`/api/v1/client-documents?orgId=${encodeURIComponent(org.id)}`)
      const docsBody: { data?: ClientDocument[] } = docsRes.ok ? await docsRes.json() : {}
      if (!cancelled) {
        setOrgId(org.id)
        setOrgName(org.name ?? '')
        setDocuments(docsBody.data ?? [])
      }
    }

    async function loadPortalDocuments() {
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
      const docsRes = await fetch(documentsUrl)
      const docsBody: { data?: ClientDocument[] } = docsRes.ok ? await docsRes.json() : {}
      const clientVisibleDocs = (docsBody.data ?? []).filter((document) => CLIENT_STATUSES.includes(document.status))
      if (!cancelled) {
        setOrgId(activeOrgId || null)
        setOrgName(activeOrgName)
        setDocuments(clientVisibleDocs)
      }
    }

    const load = surface === 'admin' ? loadAdminDocuments : loadPortalDocuments
    Promise.resolve()
      .then(() => {
        if (!cancelled) setLoading(true)
        return load()
      })
      .catch(() => {
        if (!cancelled) {
          setOrgId(null)
          setOrgName('')
          setDocuments([])
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [orgSlug, scopedOrgId, surface])

  const filteredDocuments = documents.filter((document) => {
    const statusMatches = activeStatus === 'all' ? document.status !== 'archived' : document.status === activeStatus
    const typeMatches = surface !== 'admin' || activeType === 'all' || document.type === activeType
    if (!statusMatches || !typeMatches) return false
    if (!query) return true
    return [document.title, document.type, document.status]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query)
  })

  const partyLabels: Record<string, ClientDocumentPartyLabels> = Object.fromEntries(
    filteredDocuments.map((document) => [
      document.id,
      {
        creatorCompanyName: 'Partners in Biz',
        creatorContactName: document.createdByType === 'agent' ? 'Pip' : 'PiB team',
        recipientCompanyName: orgName || 'Client workspace',
        recipientContactName: 'Client team',
      },
    ]),
  )

  const typeOptions = Array.from(new Set(documents.map((document) => document.type).filter(Boolean))).sort()
  const statusTabs = ADMIN_STATUS_TABS.map((tab) => {
    const tabParams = new URLSearchParams()
    if (tab.value !== 'all') tabParams.set('status', tab.value)
    if (activeType !== 'all') tabParams.set('type', activeType)
    if (query) tabParams.set('q', query)
    const qs = tabParams.toString()
    return {
      label: tab.label,
      value: tab.value,
      href: qs ? orgDocumentPath(orgSlug, `?${qs}`) : orgDocumentPath(orgSlug),
      badge: documents.filter((document) => tab.value === 'all' ? document.status !== 'archived' : document.status === tab.value).length,
    }
  })

  const formAction = surface === 'admin' ? orgDocumentPath(orgSlug) : '/portal/documents'
  const clearHref = surface === 'admin'
    ? clearAdminDocumentsPath(orgSlug, activeStatus)
    : scopedPortalPath('/portal/documents', routeScope)

  const content = (
    <div className={surface === 'admin' ? 'space-y-8' : 'space-y-10'}>
      <PageHeader
        eyebrow={surface === 'admin' ? orgName || 'Client workspace' : 'Client workspace / Documents'}
        title={surface === 'admin' ? 'Client Documents' : 'Your documents'}
        description={
          surface === 'admin'
            ? 'Proposals, specs, strategies, and reports for this client. Use the tabs to move between active review states.'
            : 'Proposals, specs, strategies, and reports shared with you by Partners in Biz.'
        }
        actions={surface === 'admin' ? (
          <Link href={orgDocumentPath(orgSlug, '/new')} className="btn-pib-accent">
            <span className="material-symbols-outlined text-base">add</span>
            New Document
          </Link>
        ) : undefined}
        meta={surface === 'portal' ? <span>Client-visible documents only</span> : undefined}
        tabs={surface === 'admin' ? <PageLinkTabs tabs={statusTabs} activeValue={activeStatus} ariaLabel="Document status filters" /> : undefined}
      />

      <form className="bento-card !p-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]" action={formAction}>
        {surface === 'admin' && activeStatus !== 'all' ? <input type="hidden" name="status" value={activeStatus} /> : null}
        {surface === 'portal' && routeScope.orgId ? <input type="hidden" name="orgId" value={routeScope.orgId} /> : null}
        {surface === 'portal' && routeScope.orgSlug ? <input type="hidden" name="orgSlug" value={routeScope.orgSlug} /> : null}
        {surface === 'portal' && routeScope.sourceCompanyId ? <input type="hidden" name="sourceCompanyId" value={routeScope.sourceCompanyId} /> : null}
        {surface === 'portal' && routeScope.sourceCompanyName ? <input type="hidden" name="sourceCompanyName" value={routeScope.sourceCompanyName} /> : null}
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
          <span className="eyebrow !text-[9px]">{surface === 'admin' ? 'Type' : 'Status'}</span>
          {surface === 'admin' ? (
            <select name="type" defaultValue={activeType} className="pib-select mt-1">
              <option value="all">All types</option>
              {typeOptions.map((type) => (
                <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>
              ))}
            </select>
          ) : (
            <select name="status" defaultValue={activeStatus} className="pib-select mt-1">
              <option value="all">All active documents</option>
              {CLIENT_STATUSES.map((status) => (
                <option key={status} value={status}>{statusLabel(status)}</option>
              ))}
            </select>
          )}
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn-pib-accent h-10">Apply</button>
          {((surface === 'admin' && (activeType !== 'all' || query)) || (surface === 'portal' && (activeStatus !== 'all' || query))) && (
            <a href={clearHref} className="btn-pib-secondary h-10">Clear</a>
          )}
        </div>
      </form>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className={`pib-skeleton ${surface === 'admin' ? 'h-16' : 'h-28'}`} />
          ))}
        </div>
      ) : (
        <DocumentIndex
          documents={filteredDocuments}
          basePath={surface === 'admin' ? orgDocumentPath(orgSlug) : '/portal/documents'}
          canDelete={surface === 'admin'}
          hrefFor={surface === 'portal'
            ? (document) => scopedPortalPath(`/portal/documents/${encodeURIComponent(document.id)}`, routeScope)
            : undefined}
          linkedResourceHrefFor={surface === 'portal'
            ? (resource, id) => scopedPortalPath(
              resource === 'project'
                ? `/portal/projects/${encodeURIComponent(id)}`
                : `/portal/research/${encodeURIComponent(id)}`,
              routeScope,
            )
            : undefined}
          partyLabels={partyLabels}
          onDeleted={surface === 'admin'
            ? (documentId) => setDocuments((current) => current.filter((document) => document.id !== documentId))
            : undefined}
        />
      )}
    </div>
  )

  if (surface === 'admin') {
    return (
      <OrgThemedFrame orgId={orgId} className="-m-6 min-h-screen p-6">
        {content}
      </OrgThemedFrame>
    )
  }

  return content
}
