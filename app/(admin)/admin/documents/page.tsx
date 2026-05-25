import Link from 'next/link'
import { Timestamp } from 'firebase-admin/firestore'
import type * as FirebaseFirestore from 'firebase-admin/firestore'
import { redirect } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { getCurrentAdminUserFromCookies } from '@/lib/api/currentAdmin'
import { restrictedAdminOrgIds } from '@/lib/api/platformAdmin'
import { DocumentIndex } from '@/components/client-documents/DocumentIndex'
import type { ClientDocument, ClientDocumentStatus } from '@/lib/client-documents/types'

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
  searchParams: Promise<{ status?: string }>
}) {
  const params = await searchParams
  const activeStatus = (params.status ?? 'all') as ClientDocumentStatus | 'all'
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

  const allDocuments = snap.docs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d) => serialize({ id: d.id, ...(d.data() as any) }) as ClientDocument)
    .filter((d) => d.deleted !== true)
    .filter((d) => allowedOrgIds.length === 0 || allowedOrgIds.includes(String(d.orgId ?? '')))
    .sort((a, b) => {
      const at = a.createdAt ? new Date(a.createdAt as string).getTime() : 0
      const bt = b.createdAt ? new Date(b.createdAt as string).getTime() : 0
      return bt - at
    })

  const documents =
    activeStatus === 'all'
      ? allDocuments
      : allDocuments.filter((d) => d.status === activeStatus)

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Admin workspace</p>
          <h1 className="pib-page-title mt-2">Client Documents</h1>
          <p className="pib-page-sub mt-2 max-w-2xl">
            All proposals, research reports, build specs, change requests, strategies, and monthly reports across client workspaces. Research decides what is true; specs decide what to build.
          </p>
        </div>
        <Link
          href="/admin/documents/new"
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
              ? allDocuments.length
              : allDocuments.filter((d) => d.status === tab.value).length
          const isActive = activeStatus === tab.value
          return (
            <Link
              key={tab.value}
              href={tab.value === 'all' ? '/admin/documents' : `/admin/documents?status=${tab.value}`}
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

      <DocumentIndex documents={documents} basePath="/admin/documents" canDelete />
    </div>
  )
}
