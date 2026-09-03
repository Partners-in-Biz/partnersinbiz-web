import { adminDb } from '@/lib/firebase/admin'
import { Icon } from '@/components/studio'

export const dynamic = 'force-dynamic'

const STATUS_PILL: Record<string, string> = {
  top_3: 'bg-[color-mix(in_srgb,var(--st-success)_20%,transparent)] text-[var(--st-success)] border border-[color-mix(in_srgb,var(--st-success)_30%,transparent)]',
  top_10: 'bg-[color-mix(in_srgb,var(--st-info)_20%,transparent)] text-[var(--st-info)] border border-[color-mix(in_srgb,var(--st-info)_30%,transparent)]',
  ranking: 'bg-[color-mix(in_srgb,var(--st-warning)_20%,transparent)] text-[var(--st-warning)] border border-[color-mix(in_srgb,var(--st-warning)_30%,transparent)]',
  not_yet: 'bg-[color-mix(in_srgb,var(--sc-ink)_6%,transparent)] text-[var(--sc-ink-soft)] border border-[var(--sc-line)]',
  in_progress: 'bg-[color-mix(in_srgb,var(--sc-accent)_15%,transparent)] text-[var(--sc-accent)] border border-[color-mix(in_srgb,var(--sc-accent)_30%,transparent)]',
  lost: 'bg-[color-mix(in_srgb,var(--st-danger)_20%,transparent)] text-[var(--st-danger)] border border-[color-mix(in_srgb,var(--st-danger)_30%,transparent)]',
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
    <div className="space-y-4" data-module-accent="green">
      <section className="flex items-end justify-between gap-4 flex-wrap border-b border-[var(--color-pib-line)] pb-4">
        <div>
          <p className="sc-tiny">Keyword movement</p>
          <h2 className="text-lg mt-1">Keywords</h2>
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
          <div data-impeccable-disable="content-invisible-at-rest" className="hidden md:grid grid-cols-12 gap-4 px-5 py-3 border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)]">
            <p className="col-span-4 sc-tiny !text-[10px]">Keyword</p>
            <p className="col-span-2 sc-tiny !text-[10px]">Position</p>
            <p className="col-span-2 sc-tiny !text-[10px]">Impressions</p>
            <p className="col-span-2 sc-tiny !text-[10px]">Clicks</p>
            <p className="col-span-2 sc-tiny !text-[10px]">Status</p>
          </div>
          <div className="divide-y divide-[var(--color-pib-line)]">
            {keywords.map((keyword) => (
              <div key={keyword.id} className="grid grid-cols-2 md:grid-cols-12 gap-3 md:gap-4 px-5 py-4 hover:bg-[var(--color-pib-surface-2)] transition-colors">
                <div className="col-span-2 md:col-span-4">
                  <p className="">{keyword.keyword}</p>
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
        <p className="sc-tiny !text-[10px]">{label}</p>
        <span aria-hidden="true" className="!h-7 !w-7"><Icon name={icon} /></span>
      </div>
      <p className="mt-3 text-xl tabular-nums tracking-tight">{value}</p>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="md:col-span-2">
      <p className="md:hidden sc-tiny !text-[9px] mb-1">{label}</p>
      <p className="text-sm tabular-nums">{value}</p>
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
