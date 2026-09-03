import { adminDb } from '@/lib/firebase/admin'
import { Icon } from '@/components/studio'

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
    <div className="space-y-4" data-module-accent="green">
      <section className="flex items-end justify-between gap-4 flex-wrap border-b border-[var(--color-pib-line)] pb-4">
        <div>
          <p className="sc-tiny">Published content</p>
          <h2 className="text-lg mt-1">Blog</h2>
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
            <article key={item.id} className="st-panel p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="sc-tiny !text-[10px]">{item.type ?? 'Blog post'}</p>
                  <h3 className="font-headline text-lg mt-2 leading-tight">{item.title}</h3>
                  <p className="text-xs text-[var(--color-pib-text-muted)] mt-2">
                    {item.publishDate ? new Date(item.publishDate).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date TBD'}
                  </p>
                </div>
                <span className="pib-pill pib-pill-success">
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
                    <Icon name="open_in_new" />
                    View post
                  </a>
                )}
                {item.liUrl && <span className="pib-pill pib-pill-success">LinkedIn shared</span>}
                {item.xUrl && <span className="pib-pill pib-pill-success">X shared</span>}
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
