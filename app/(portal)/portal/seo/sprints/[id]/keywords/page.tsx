import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

const STATUS_PILL: Record<string, string> = {
  top_3: 'bg-emerald-700/30 text-emerald-200 border border-emerald-600/30',
  top_10: 'bg-blue-700/30 text-blue-200 border border-blue-600/30',
  ranking: 'bg-amber-700/30 text-amber-200 border border-amber-600/30',
  not_yet: 'bg-zinc-700/30 text-zinc-300 border border-zinc-600/30',
  in_progress: 'bg-violet-700/30 text-violet-200 border border-violet-600/30',
  lost: 'bg-red-700/30 text-red-200 border border-red-600/30',
}

export default async function PortalKeywordsTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const snap = await adminDb
    .collection('seo_keywords')
    .where('sprintId', '==', id)
    .where('deleted', '==', false)
    .get()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keywords = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
  keywords.sort((a, b) => (a.currentPosition ?? 999) - (b.currentPosition ?? 999))

  const topThree = keywords.filter((keyword) => keyword.status === 'top_3').length
  const topTen = keywords.filter((keyword) => keyword.status === 'top_10' || keyword.status === 'top_3').length
  const impressions = keywords.reduce((sum, keyword) => sum + Number(keyword.currentImpressions ?? 0), 0)
  const clicks = keywords.reduce((sum, keyword) => sum + Number(keyword.currentClicks ?? 0), 0)

  return (
    <div className="space-y-6">
      <section className="flex items-end justify-between gap-4 flex-wrap border-b border-[var(--color-pib-line)] pb-4">
        <div>
          <p className="eyebrow">Keyword movement</p>
          <h2 className="font-headline text-2xl md:text-3xl font-semibold mt-2">Keywords</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-1.5">
            Ranking targets, current positions, and Search Console traction.
          </p>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Tracked" value={String(keywords.length)} icon="key" />
        <StatTile label="Top 3" value={String(topThree)} icon="emoji_events" />
        <StatTile label="Top 10" value={String(topTen)} icon="leaderboard" />
        <StatTile label="Clicks" value={clicks.toLocaleString('en-ZA')} icon="ads_click" />
      </section>

      {keywords.length === 0 ? (
        <EmptyState icon="key_off" title="Keyword tracking has not started yet" body="Keyword data usually starts appearing after the early foundation work and Search Console syncs." />
      ) : (
        <div className="pib-card-section overflow-hidden">
          <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-3 border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)]">
            <p className="col-span-4 eyebrow !text-[10px]">Keyword</p>
            <p className="col-span-2 eyebrow !text-[10px]">Position</p>
            <p className="col-span-2 eyebrow !text-[10px]">Impressions</p>
            <p className="col-span-2 eyebrow !text-[10px]">Clicks</p>
            <p className="col-span-2 eyebrow !text-[10px]">Status</p>
          </div>
          <div className="divide-y divide-[var(--color-pib-line)]">
            {keywords.map((keyword) => (
              <div key={keyword.id} className="grid grid-cols-2 md:grid-cols-12 gap-3 md:gap-4 px-5 py-4 hover:bg-[var(--color-pib-surface-2)] transition-colors">
                <div className="col-span-2 md:col-span-4">
                  <p className="font-semibold">{keyword.keyword}</p>
                  {keyword.targetPageUrl && <p className="text-xs text-[var(--color-pib-text-muted)] mt-1 truncate">{keyword.targetPageUrl.replace(/^https?:\/\//, '')}</p>}
                </div>
                <Metric label="Position" value={keyword.currentPosition ? `#${keyword.currentPosition.toFixed(1)}` : '-'} />
                <Metric label="Impressions" value={Number(keyword.currentImpressions ?? 0).toLocaleString('en-ZA')} />
                <Metric label="Clicks" value={Number(keyword.currentClicks ?? 0).toLocaleString('en-ZA')} />
                <div className="md:col-span-2">
                  <span className={`text-[10px] px-2 py-1 rounded uppercase tracking-wide ${STATUS_PILL[keyword.status] ?? STATUS_PILL.not_yet}`}>
                    {keyword.status ?? 'not_yet'}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {impressions > 0 && (
            <div className="px-5 py-4 border-t border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] text-xs text-[var(--color-pib-text-muted)]">
              {impressions.toLocaleString('en-ZA')} total impressions across tracked keywords.
            </div>
          )}
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="md:col-span-2">
      <p className="md:hidden eyebrow !text-[9px] mb-1">{label}</p>
      <p className="text-sm tabular-nums">{value}</p>
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
