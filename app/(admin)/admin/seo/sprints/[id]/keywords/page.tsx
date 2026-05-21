import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

const STATUS_PILL: Record<string, string> = {
  top_3: 'pib-pill pib-pill-success',
  top_10: 'pib-pill pib-pill-info',
  ranking: 'pib-pill pib-pill-warn',
  not_yet: 'pib-pill',
  in_progress: 'pib-pill pib-pill-accent',
  lost: 'pib-pill pib-pill-danger',
}

export default async function KeywordsTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const snap = await adminDb
    .collection('seo_keywords')
    .where('sprintId', '==', id)
    .where('deleted', '==', false)
    .get()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keywords = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
  keywords.sort((a, b) => (a.currentPosition ?? 999) - (b.currentPosition ?? 999))

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="pib-label mb-2">Search demand</p>
          <h2 className="text-2xl font-semibold text-[var(--color-pib-text)]">Keywords</h2>
        </div>
        <span className="pib-pill">{keywords.length} tracked</span>
      </header>

      {keywords.length === 0 ? (
        <div className="pib-card py-10 text-center text-sm text-[var(--color-pib-text-muted)]">
          <span className="material-symbols-outlined mb-2 block text-3xl">manage_search</span>
          No keywords yet. Add via <code>POST /api/v1/seo/sprints/{id}/keywords</code> or use{' '}
          <a href="/admin/seo/tools" className="underline">
            keyword discovery
          </a>
          .
        </div>
      ) : (
        <div className="pib-card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] text-left text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">
              <tr>
                <th className="px-4 py-3">Keyword</th>
                <th className="px-4 py-3">Vol</th>
                <th className="px-4 py-3">Top-3 DR</th>
                <th className="px-4 py-3">Intent</th>
                <th className="px-4 py-3">Position</th>
                <th className="px-4 py-3">Impr</th>
                <th className="px-4 py-3">Clicks</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-pib-line)]">
              {keywords.map((k) => (
                <tr key={k.id} className="transition-colors hover:bg-white/[0.03]">
                  <td className="px-4 py-3 font-medium text-[var(--color-pib-text)]">{k.keyword}</td>
                  <td className="px-4 py-3">{k.volume ?? '—'}</td>
                  <td className="px-4 py-3">{k.topThreeDR ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-[var(--color-pib-text-muted)]">{k.intentBucket}</td>
                  <td className="px-4 py-3">{k.currentPosition ? k.currentPosition.toFixed(1) : '—'}</td>
                  <td className="px-4 py-3">{k.currentImpressions ?? 0}</td>
                  <td className="px-4 py-3">{k.currentClicks ?? 0}</td>
                  <td className="px-4 py-3">
                    <span className={STATUS_PILL[k.status] ?? 'pib-pill'}>{k.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
