import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

export default async function AuditsTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const snap = await adminDb.collection('seo_audits').where('sprintId', '==', id).where('deleted', '==', false).get()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const audits = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
  audits.sort((a, b) => (a.snapshotDay ?? 0) - (b.snapshotDay ?? 0))
  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="pib-label mb-2">Snapshot history</p>
          <h2 className="text-2xl font-semibold text-[var(--color-pib-text)]">Audits</h2>
        </div>
        <form action={`/api/v1/seo/sprints/${id}/audits`} method="POST">
          <button className="pib-btn-primary text-sm">
            <span className="material-symbols-outlined text-[18px]">add_chart</span>
            Generate snapshot now
          </button>
        </form>
      </header>
      {audits.length === 0 ? (
        <div className="pib-card py-10 text-center text-sm text-[var(--color-pib-text-muted)]">
          <span className="material-symbols-outlined mb-2 block text-3xl">query_stats</span>
          No audits yet. Day 1 / 30 / 60 / 90 snapshots will appear here.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {audits.map((a) => (
            <div key={a.id} className="pib-card space-y-4">
              <div className="pib-pill">
                {a.snapshotDay === 1 ? 'Day 1 baseline' : `Day ${a.snapshotDay}`}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-[var(--color-pib-line)] bg-white/[0.02] p-3">
                  <p className="text-2xl font-semibold">{a.traffic?.impressions ?? 0}</p>
                  <p className="text-xs text-[var(--color-pib-text-muted)]">impressions</p>
                </div>
                <div className="rounded-2xl border border-[var(--color-pib-line)] bg-white/[0.02] p-3">
                  <p className="text-2xl font-semibold">{a.traffic?.clicks ?? 0}</p>
                  <p className="text-xs text-[var(--color-pib-text-muted)]">clicks</p>
                </div>
              </div>
              <div className="text-xs text-[var(--color-pib-text-muted)]">
                {a.rankings?.top10 ?? 0} top-10 · {a.authority?.totalBacklinks ?? 0} backlinks
              </div>
              <div className="flex gap-2 pt-2">
                <a
                  href={`/api/v1/seo/audits/${a.id}/share`}
                  className="pib-btn-secondary !px-3 !py-1.5 text-xs"
                >
                  <span className="material-symbols-outlined text-base">ios_share</span>
                  Share
                </a>
                <a href={`/api/v1/seo/audits/${a.id}/report.pdf`} className="pib-btn-secondary !px-3 !py-1.5 text-xs">
                  <span className="material-symbols-outlined text-base">picture_as_pdf</span>
                  PDF
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
