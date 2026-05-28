import Link from 'next/link'
import { Timestamp } from 'firebase-admin/firestore'
import type * as FirebaseFirestore from 'firebase-admin/firestore'
import { redirect } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { getCurrentAdminUserFromCookies } from '@/lib/api/currentAdmin'
import { restrictedAdminOrgIds } from '@/lib/api/platformAdmin'
import { DocumentIndex, type ClientDocumentPartyLabels } from '@/components/client-documents/DocumentIndex'
import { PageHeader, PageLinkTabs } from '@/components/ui/AppFoundation'
import type { ClientDocument, ClientDocumentStatus } from '@/lib/client-documents/types'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(value: any): any {
  if (value === null || value === undefined) return value
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(serialize)
  if (typeof value === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v)
    return out
  }
  return value
}

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

export default async function DocumentsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; orgId?: string; q?: string }>
}) {
  const params = await searchParams
  const activeStatus = (params.status ?? 'all') as ClientDocumentStatus | 'all'
  const selectedOrgId = params.orgId ?? ''
  const search = (params.q ?? '').trim()
  const q = search.toLowerCase()
  const user = await getCurrentAdminUserFromCookies()
  if (!user) redirect('/login')
  const allowedOrgIds = restrictedAdminOrgIds(user)

  let query: FirebaseFirestore.Query = adminDb.collection('client_documents')
  if (allowedOrgIds.length > 0 && allowedOrgIds.length <= 30) {
    query = query.where('orgId', 'in', allowedOrgIds)
  } else {
    query = query.where('deleted', '==', false)
  }

  const snap = await query.get()
  const [orgSnap, companySnap] = await Promise.all([
    adminDb.collection('organizations').where('active', '==', true).get(),
    adminDb.collection('companies').where('orgId', '==', PIB_PLATFORM_ORG_ID).get(),
  ])
  const orgOptions = orgSnap.docs
    .map((doc) => {
      const data = doc.data() as { name?: string; type?: string }
      return { id: doc.id, name: data.name ?? doc.id, type: data.type ?? 'client' }
    })
    .filter((org) => org.type === 'client')
    .filter((org) => allowedOrgIds.length === 0 || allowedOrgIds.includes(org.id))
    .sort((a, b) => a.name.localeCompare(b.name))
  const orgNameById = new Map(orgOptions.map((org) => [org.id, org.name]))
  const companyNameById = new Map(
    companySnap.docs.map((doc) => {
      const data = doc.data() as { name?: string }
      return [doc.id, data.name ?? doc.id] as const
    }),
  )

  const allDocuments = snap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d) => serialize({ id: d.id, ...(d.data() as any) }) as ClientDocument)
    .filter((d) => d.deleted !== true)
    .filter((d) => allowedOrgIds.length === 0 || allowedOrgIds.includes(String(d.orgId ?? '')))
    .filter((d) => !selectedOrgId || String(d.orgId ?? '') === selectedOrgId)
    .filter((d) => {
      if (!q) return true
      const raw = d as ClientDocument & Record<string, unknown>
      const clientName = orgOptions.find((org) => org.id === d.orgId)?.name ?? ''
      return [d.title, d.type, d.status, raw.summary, raw.description, clientName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
    .sort((a, b) => {
      const at = a.createdAt ? new Date(a.createdAt as string).getTime() : 0
      const bt = b.createdAt ? new Date(b.createdAt as string).getTime() : 0
      return bt - at
    })

  const documents =
    activeStatus === 'all'
      ? allDocuments
      : allDocuments.filter((d) => d.status === activeStatus)
  const relationshipLabels = Object.fromEntries(
    documents.map((document) => [
      document.id,
      {
        companyName: document.linked?.companyId ? companyNameById.get(document.linked.companyId) : undefined,
        clientOrgName: document.linked?.clientOrgId ? orgNameById.get(document.linked.clientOrgId) : undefined,
      },
    ]),
  )
  const partyLabels: Record<string, ClientDocumentPartyLabels> = Object.fromEntries(
    documents.map((document) => {
      const recipientOrgId = document.linked?.clientOrgId || (
        document.orgId && document.orgId !== PIB_PLATFORM_ORG_ID ? document.orgId : ''
      )
      const recipientOrgName = recipientOrgId ? orgNameById.get(recipientOrgId) : undefined
      const recipientCompanyName = document.linked?.companyId
        ? companyNameById.get(document.linked.companyId) ?? recipientOrgName
        : recipientOrgName
      return [
        document.id,
        {
          creatorCompanyName: 'Partners in Biz',
          creatorContactName: document.createdByType === 'agent' ? 'Pip' : 'PiB team',
          recipientCompanyName: recipientCompanyName ?? 'Internal workspace',
          recipientContactName: recipientCompanyName ? 'Client team' : 'Internal team',
        },
      ]
    }),
  )
  const statusTabs = STATUS_TABS.map((tab) => ({
    label: tab.label,
    value: tab.value,
    href: buildDocumentsHref({ status: tab.value, orgId: selectedOrgId, q: search }),
    badge: allDocuments.filter((d) => tab.value === 'all' || d.status === tab.value).length,
  }))

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin workspace"
        title="Client Documents"
        description="All proposals, research reports, build specs, change requests, strategies, and monthly reports across client workspaces. Research decides what is true; specs decide what to build."
        actions={(
          <Link
            href="/admin/documents/new"
            className="btn-pib-accent"
          >
            <span className="material-symbols-outlined text-base">add</span>
            New Document
          </Link>
        )}
        tabs={<PageLinkTabs tabs={statusTabs} activeValue={activeStatus} ariaLabel="Document status filters" />}
      />

      <form className="bento-card !p-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]" action="/admin/documents">
        {activeStatus !== 'all' && <input type="hidden" name="status" value={activeStatus} />}
        <label className="block">
          <span className="eyebrow !text-[9px]">Search</span>
          <input
            name="q"
            defaultValue={search}
            placeholder="Search title, type, status, summary, or client..."
            className="pib-input mt-1"
          />
        </label>
        <label className="block">
          <span className="eyebrow !text-[9px]">Client</span>
          <select name="orgId" defaultValue={selectedOrgId} className="pib-select mt-1">
            <option value="">All clients</option>
            {orgOptions.map((org) => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn-pib-accent h-10">Apply</button>
          {(selectedOrgId || search) && (
            <Link href={buildDocumentsHref({ status: activeStatus, orgId: '', q: '' })} className="btn-pib-secondary h-10">
              Clear
            </Link>
          )}
        </div>
      </form>

      <DocumentIndex
        documents={documents}
        basePath="/admin/documents"
        canDelete
        relationshipLabels={relationshipLabels}
        partyLabels={partyLabels}
      />
    </div>
  )
}

function buildDocumentsHref({
  status,
  orgId,
  q,
}: {
  status: ClientDocumentStatus | 'all'
  orgId: string
  q: string
}) {
  const params = new URLSearchParams()
  if (status !== 'all') params.set('status', status)
  if (orgId) params.set('orgId', orgId)
  if (q.trim()) params.set('q', q.trim())
  const qs = params.toString()
  return qs ? `/admin/documents?${qs}` : '/admin/documents'
}
