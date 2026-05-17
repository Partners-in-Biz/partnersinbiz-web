import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

export default async function PortalPagesTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const snap = await adminDb
    .collection('seo_keywords')
    .where('sprintId', '==', id)
    .where('deleted', '==', false)
    .get()

  const byPage = new Map<string, PageMetric>()
  for (const doc of snap.docs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const keyword = doc.data() as any
    if (!keyword.targetPageUrl) continue
    const current = byPage.get(keyword.targetPageUrl) ?? {
      url: keyword.targetPageUrl,
      keywords: 0,
      impressions: 0,
      clicks: 0,
      bestPosition: 999,
      topQuery: '',
    }
    current.keywords += 1
    current.impressions += Number(keyword.currentImpressions ?? 0)
    current.clicks += Number(keyword.currentClicks ?? 0)
    if (keyword.currentPosition && keyword.currentPosition < current.bestPosition) {
      current.bestPosition = keyword.currentPosition
      current.topQuery = keyword.keyword
    }
    byPage.set(keyword.targetPageUrl, current)
  }
  const pages = [...byPage.values()].sort((a, b) => b.impressions - a.impressions)
  const clicks = pages.reduce((sum, page) => sum + page.clicks, 0)
  const impressions = pages.reduce((sum, page) => sum + page.impressions, 0)

  return (
    <div className="space-y-6">
      <section className="flex items-end justify-between gap-4 flex-wrap border-b border-[var(--color-pib-line)] pb-4">
        <div>
          <p className="eyebrow">Page performance</p>
          <h2 className="font-headline text-2xl md:text-3xl font-semibold mt-2">Pages</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-1.5">
            Page-level keyword coverage, best rankings, impressions, and clicks.
          </p>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Pages" value={String(pages.length)} icon="description" />
        <StatTile label="Keywords" value={String(pages.reduce((sum, page) => sum + page.keywords, 0))} icon="key" />
        <StatTile label="Impressions" value={impressions.toLocaleString('en-ZA')} icon="visibility" />
        <StatTile label="Clicks" value={clicks.toLocaleString('en-ZA')} icon="ads_click" />
      </section>

      {pages.length === 0 ? (
        <EmptyState icon="description" title="No page data yet" body="Per-page data appears here once Google Search Console data starts flowing into tracked keywords." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {pages.map((page) => (
            <article key={page.url} className="pib-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="eyebrow !text-[10px]">Tracked page</p>
                  <a href={page.url} target="_blank" rel="noopener" className="font-headline text-lg font-semibold mt-2 block truncate hover:text-[var(--color-pib-accent)]">
                    {page.url.replace(/^https?:\/\//, '')}
                  </a>
                  <p className="text-xs text-[var(--color-pib-text-muted)] mt-2 truncate">
                    Top query: {page.topQuery || '-'}
                  </p>
                </div>
                <span className="material-symbols-outlined text-[24px] text-[var(--color-pib-accent)]">open_in_new</span>
              </div>
              <div className="grid grid-cols-4 gap-2 mt-5">
                <MiniMetric label="Best" value={page.bestPosition < 999 ? `#${page.bestPosition.toFixed(1)}` : '-'} />
                <MiniMetric label="Impr" value={String(page.impressions)} />
                <MiniMetric label="Clicks" value={String(page.clicks)} />
                <MiniMetric label="Keys" value={String(page.keywords)} />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

interface PageMetric {
  url: string
  keywords: number
  impressions: number
  clicks: number
  bestPosition: number
  topQuery: string
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
