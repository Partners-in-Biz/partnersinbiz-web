import { adminDb } from '@/lib/firebase/admin'
import { ContentRow } from './ContentRow'

export const dynamic = 'force-dynamic'

export default async function ContentTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const snap = await adminDb
    .collection('seo_content')
    .where('sprintId', '==', id)
    .where('deleted', '==', false)
    .get()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))

  // Resolve keyword strings for any rows with targetKeywordId
  const kwIds = Array.from(new Set(items.map((i) => i.targetKeywordId).filter(Boolean) as string[]))
  const kwMap: Record<string, string> = {}
  if (kwIds.length) {
    const kwDocs = await Promise.all(
      kwIds.map((kid) => adminDb.collection('seo_keywords').doc(kid).get()),
    )
    for (const k of kwDocs) {
      if (k.exists) kwMap[k.id] = (k.data() as { keyword?: string } | undefined)?.keyword ?? ''
    }
  }

  // Prefetch draft bodies for rows that have a draftPostId. Done server-side so the
  // client doesn't need a per-org-scoped API call (the cockpit can be operated by an
  // admin viewing a different workspace context).
  const draftIds = Array.from(new Set(items.map((i) => i.draftPostId).filter(Boolean) as string[]))
  const draftMap: Record<string, { body?: string; metaDescription?: string; wordCount?: number; generatedBy?: string }> = {}
  if (draftIds.length) {
    const draftDocs = await Promise.all(
      draftIds.map((did) => adminDb.collection('seo_drafts').doc(did).get()),
    )
    for (const d of draftDocs) {
      if (d.exists) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = d.data() as any
        draftMap[d.id] = {
          body: data.body,
          metaDescription: data.metaDescription,
          wordCount: data.wordCount,
          generatedBy: data.generatedBy,
        }
      }
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="pib-label mb-2">Content engine</p>
          <h2 className="text-2xl font-semibold text-[var(--color-pib-text)]">Content</h2>
        </div>
        <span className="pib-pill">{items.length} items</span>
      </header>
      {items.length === 0 ? (
        <div className="pib-card py-10 text-center text-sm text-[var(--color-pib-text-muted)]">
          <span className="material-symbols-outlined mb-2 block text-3xl">article</span>
          No content yet. Add via <code>POST /api/v1/seo/sprints/{id}/content</code>.
        </div>
      ) : (
        <div className="pib-card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] text-left text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">
              <tr>
                <th className="w-8 px-4 py-3"></th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Keyword</th>
                <th className="px-4 py-3">Phase</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Publish date</th>
                <th className="px-4 py-3">URL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-pib-line)]">
              {items.map((c) => (
                <ContentRow
                  key={c.id}
                  id={c.id}
                  title={c.title}
                  keyword={c.targetKeywordId ? kwMap[c.targetKeywordId] ?? '—' : '—'}
                  phase={c.phase ?? null}
                  type={c.type}
                  status={c.status}
                  publishDate={c.publishDate}
                  targetUrl={c.targetUrl}
                  draftPostId={c.draftPostId}
                  draft={c.draftPostId ? draftMap[c.draftPostId] : undefined}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
