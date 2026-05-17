import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

export default async function PortalPerformanceTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auditsSnap = await adminDb
    .collection('seo_audits')
    .where('sprintId', '==', id)
    .where('deleted', '==', false)
    .get()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const audits = auditsSnap.docs.map((doc) => doc.data() as any).sort((a, b) => (a.snapshotDay ?? 0) - (b.snapshotDay ?? 0))
  const baseline = audits[0]
  const latest = audits[audits.length - 1]

  function pctChange(start?: number, current?: number) {
    if (!start || !current) return null
    return Math.round(((current - start) / start) * 100)
  }

  const impressionsChange = pctChange(baseline?.traffic?.impressions, latest?.traffic?.impressions)
  const clicksChange = pctChange(baseline?.traffic?.clicks, latest?.traffic?.clicks)
  const healthSnap = await adminDb.collection('seo_sprints').doc(id).collection('page_health').get()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const homepage = healthSnap.docs[0]?.data() as any | undefined

  return (
    <div className="space-y-6">
      <section className="flex items-end justify-between gap-4 flex-wrap border-b border-[var(--color-pib-line)] pb-4">
        <div>
          <p className="eyebrow">Performance signals</p>
          <h2 className="font-headline text-2xl md:text-3xl font-semibold mt-2">Performance</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-1.5">
            Audit trend, organic traffic signals, and page experience health.
          </p>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="Impressions" value={latest?.traffic?.impressions ?? 0} change={impressionsChange} icon="visibility" />
        <Stat label="Clicks" value={latest?.traffic?.clicks ?? 0} change={clicksChange} icon="ads_click" />
        <Stat label="Top 10 keywords" value={latest?.rankings?.top10 ?? 0} icon="leaderboard" />
      </section>

      {homepage && (
        <section className="pib-card p-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Page experience</p>
              <h3 className="font-headline text-xl font-semibold mt-2">Core Web Vitals</h3>
              <p className="text-sm text-[var(--color-pib-text-muted)] mt-1">Homepage health from the latest page check.</p>
            </div>
            <span className="material-symbols-outlined text-[24px] text-[var(--color-pib-accent)]">speed</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <CWV label="LCP" value={homepage.lcp ? `${Math.round(homepage.lcp)}ms` : '-'} ok={homepage.lcp <= 2500} />
            <CWV label="CLS" value={homepage.cls?.toFixed?.(2) ?? '-'} ok={homepage.cls <= 0.1} />
            <CWV label="Performance" value={homepage.performance ?? '-'} ok={homepage.performance >= 75} />
          </div>
        </section>
      )}

      {audits.length === 0 && (
        <EmptyState icon="monitoring" title="No performance snapshots yet" body="Performance data appears here after the first audit snapshot." />
      )}
    </div>
  )
}

function Stat({ label, value, change, icon }: { label: string; value: number; change?: number | null; icon: string }) {
  return (
    <div className="pib-stat-card">
      <div className="flex items-start justify-between">
        <p className="eyebrow !text-[10px]">{label}</p>
        <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">{icon}</span>
      </div>
      <p className="mt-3 font-display tracking-tight leading-none text-3xl md:text-4xl tabular-nums">{Number(value).toLocaleString('en-ZA')}</p>
      {change != null && (
        <p className={`text-xs mt-3 ${change >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
          {change >= 0 ? '+' : ''}
          {change}% vs Day 1
        </p>
      )}
    </div>
  )
}

function CWV({ label, value, ok }: { label: string; value: string | number; ok: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-4">
      <p className="eyebrow !text-[10px]">{label}</p>
      <p className={`font-display text-3xl tabular-nums mt-2 ${ok ? 'text-emerald-300' : 'text-amber-300'}`}>{value}</p>
      <p className="text-xs text-[var(--color-pib-text-muted)] mt-2">{ok ? 'Healthy' : 'Needs attention'}</p>
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
