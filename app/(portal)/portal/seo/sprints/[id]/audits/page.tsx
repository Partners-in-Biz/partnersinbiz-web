import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

export default async function PortalAuditsTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const snap = await adminDb
    .collection('seo_audits')
    .where('sprintId', '==', id)
    .where('deleted', '==', false)
    .get()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const audits = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
  audits.sort((a, b) => (a.snapshotDay ?? 0) - (b.snapshotDay ?? 0))

  const latest = audits[audits.length - 1]
  const clicks = latest?.traffic?.clicks ?? 0
  const impressions = latest?.traffic?.impressions ?? 0
  const topTen = latest?.rankings?.top10 ?? 0

  return (
    <div className="space-y-6">
      <section className="flex items-end justify-between gap-4 flex-wrap border-b border-[var(--color-pib-line)] pb-4">
        <div>
          <p className="eyebrow">Audit snapshots</p>
          <h2 className="font-headline text-2xl md:text-3xl font-semibold mt-2">Audits</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-1.5">
            Baseline and milestone snapshots showing traffic, rankings, and report links.
          </p>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Reports" value={String(audits.length)} icon="monitoring" />
        <StatTile label="Impressions" value={Number(impressions).toLocaleString('en-ZA')} icon="visibility" />
        <StatTile label="Clicks" value={Number(clicks).toLocaleString('en-ZA')} icon="ads_click" />
        <StatTile label="Top 10" value={String(topTen)} icon="leaderboard" />
      </section>

      {audits.length === 0 ? (
        <EmptyState icon="health_and_safety" title="No audit reports yet" body="Day 1, 30, 60, and 90 audit reports will appear here as the sprint progresses." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {audits.map((audit) => (
            <article key={audit.id} className="pib-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="eyebrow !text-[10px]">{audit.snapshotDay === 1 ? 'Baseline' : `Day ${audit.snapshotDay}`}</p>
                  <h3 className="font-headline text-xl font-semibold mt-2">{Number(audit.traffic?.impressions ?? 0).toLocaleString('en-ZA')} impressions</h3>
                </div>
                <span className="material-symbols-outlined text-[24px] text-[var(--color-pib-accent)]">query_stats</span>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-5">
                <MiniMetric label="Clicks" value={String(audit.traffic?.clicks ?? 0)} />
                <MiniMetric label="Top 10" value={String(audit.rankings?.top10 ?? 0)} />
                <MiniMetric label="Score" value={audit.score != null ? String(audit.score) : '-'} />
              </div>
              {audit.publicShareToken && (
                <a
                  href={`/seo-audit/${audit.publicShareToken}`}
                  target="_blank"
                  rel="noopener"
                  className="pib-btn-secondary mt-5 inline-flex"
                >
                  <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                  Open report
                </a>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function StatTile({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="pib-stat-card">
      <div className="flex items-start justify-between">
        <p className="eyebrow !text-[10px]">{label}</p>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{icon}</span>
      </div>
      <p className="mt-3 font-display tracking-tight leading-none text-3xl md:text-4xl">{value}</p>
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-3">
      <p className="eyebrow !text-[9px]">{label}</p>
      <p className="font-medium text-sm tabular-nums mt-1">{value}</p>
    </div>
  )
}

function EmptyState({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="pib-card p-10 text-center">
      <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">{icon}</span>
      <h3 className="font-headline text-lg font-semibold mt-3">{title}</h3>
      <p className="text-sm text-[var(--color-pib-text-muted)] mt-1.5 max-w-md mx-auto">{body}</p>
    </div>
  )
}
