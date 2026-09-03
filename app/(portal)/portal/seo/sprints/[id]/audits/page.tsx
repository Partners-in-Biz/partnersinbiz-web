import { adminDb } from '@/lib/firebase/admin'
import { Icon } from '@/components/studio'

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
    <div className="space-y-4" data-module-accent="green">
      <section className="flex items-end justify-between gap-4 flex-wrap border-b border-[var(--color-pib-line)] pb-4">
        <div>
          <p className="sc-tiny">Audit snapshots</p>
          <h2 className="text-lg mt-1">Audits</h2>
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
            <article key={audit.id} className="st-panel p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="sc-tiny !text-[10px]">{audit.snapshotDay === 1 ? 'Baseline' : `Day ${audit.snapshotDay}`}</p>
                  <h3 className="font-headline text-xl mt-2">{Number(audit.traffic?.impressions ?? 0).toLocaleString('en-ZA')} impressions</h3>
                </div>
                <Icon name="query_stats" />
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
                  <Icon name="open_in_new" />
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
        <p className="sc-tiny !text-[10px]">{label}</p>
        <span aria-hidden="true" className="!h-7 !w-7"><Icon name={icon} /></span>
      </div>
      <p className="mt-3 text-xl tabular-nums tracking-tight">{value}</p>
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-3">
      <p className="sc-tiny !text-[9px]">{label}</p>
      <p className="font-medium text-sm tabular-nums mt-1">{value}</p>
    </div>
  )
}

function EmptyState({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="st-panel p-6 text-center">
      <Icon name={icon} />
      <h3 className="font-headline text-lg mt-3">{title}</h3>
      <p className="text-sm text-[var(--color-pib-text-muted)] mt-1.5 max-w-md mx-auto">{body}</p>
    </div>
  )
}
