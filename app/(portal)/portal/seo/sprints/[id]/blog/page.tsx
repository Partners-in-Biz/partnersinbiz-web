import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

export default async function PortalBlogTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const snap = await adminDb
    .collection('seo_content')
    .where('sprintId', '==', id)
    .where('deleted', '==', false)
    .get()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
  const live = all.filter((item) => item.status === 'live')
  const impressions = live.reduce((sum, item) => sum + Number(item.performance?.impressions ?? 0), 0)
  const clicks = live.reduce((sum, item) => sum + Number(item.performance?.clicks ?? 0), 0)
  const shared = live.filter((item) => item.liUrl || item.xUrl).length

  return (
    <div className="space-y-6">
      <section className="flex items-end justify-between gap-4 flex-wrap border-b border-[var(--color-pib-line)] pb-4">
        <div>
          <p className="eyebrow">Published content</p>
          <h2 className="font-headline text-2xl md:text-3xl font-semibold mt-2">Blog</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-1.5">
            Live SEO posts and the early performance signals attached to each post.
          </p>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Live posts" value={String(live.length)} icon="rss_feed" />
        <StatTile label="Shared" value={String(shared)} icon="share" />
        <StatTile label="Impressions" value={impressions.toLocaleString('en-ZA')} icon="visibility" />
        <StatTile label="Clicks" value={clicks.toLocaleString('en-ZA')} icon="ads_click" />
      </section>

      {live.length === 0 ? (
        <EmptyState icon="rss_feed" title="No published posts yet" body="Published posts will appear here once content goes live." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {live.map((item) => (
            <article key={item.id} className="pib-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="eyebrow !text-[10px]">{item.type ?? 'Blog post'}</p>
                  <h3 className="font-headline text-lg font-semibold mt-2 leading-tight">{item.title}</h3>
                  <p className="text-xs text-[var(--color-pib-text-muted)] mt-2">
                    {item.publishDate ? new Date(item.publishDate).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date TBD'}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-700/30 text-emerald-200 border border-emerald-600/30 px-2 py-1 text-[10px] uppercase tracking-wide">
                  live
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-5">
                <MiniMetric label="Impressions" value={String(item.performance?.impressions ?? 0)} />
                <MiniMetric label="Clicks" value={String(item.performance?.clicks ?? 0)} />
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {item.targetUrl && (
                  <a href={item.targetUrl} target="_blank" rel="noopener" className="pib-btn-secondary">
                    <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                    View post
                  </a>
                )}
                {item.liUrl && <span className="rounded-full border border-[var(--color-pib-line)] px-3 py-1.5 text-xs text-[var(--color-pib-text-muted)]">LinkedIn shared</span>}
                {item.xUrl && <span className="rounded-full border border-[var(--color-pib-line)] px-3 py-1.5 text-xs text-[var(--color-pib-text-muted)]">X shared</span>}
              </div>
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
