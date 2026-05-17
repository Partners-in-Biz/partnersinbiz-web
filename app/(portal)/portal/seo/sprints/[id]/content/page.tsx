import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

const STATUS_PILL: Record<string, string> = {
  idea: 'bg-zinc-700/30 text-zinc-300 border border-zinc-600/30',
  drafting: 'bg-amber-700/30 text-amber-200 border border-amber-600/30',
  review: 'bg-violet-700/30 text-violet-200 border border-violet-600/30',
  scheduled: 'bg-blue-700/30 text-blue-200 border border-blue-600/30',
  live: 'bg-emerald-700/30 text-emerald-200 border border-emerald-600/30',
}

const PIPELINE = ['idea', 'drafting', 'review', 'scheduled', 'live']

export default async function PortalContentTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const snap = await adminDb
    .collection('seo_content')
    .where('sprintId', '==', id)
    .where('deleted', '==', false)
    .get()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
  content.sort((a, b) => Date.parse(a.publishDate ?? '') - Date.parse(b.publishDate ?? ''))
  const live = content.filter((item) => item.status === 'live').length
  const review = content.filter((item) => item.status === 'review').length

  return (
    <div className="space-y-6">
      <section className="flex items-end justify-between gap-4 flex-wrap border-b border-[var(--color-pib-line)] pb-4">
        <div>
          <p className="eyebrow">Editorial pipeline</p>
          <h2 className="font-headline text-2xl md:text-3xl font-semibold mt-2">Content</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-1.5">
            Planned, drafted, reviewed, scheduled, and live SEO content.
          </p>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Pieces" value={String(content.length)} icon="article" />
        <StatTile label="In review" value={String(review)} icon="rate_review" />
        <StatTile label="Live" value={String(live)} icon="published_with_changes" />
        <StatTile label="Drafting" value={String(content.filter((item) => item.status === 'drafting').length)} icon="edit_note" />
      </section>

      {content.length === 0 ? (
        <EmptyState icon="article" title="No content planned yet" body="Content ideas, drafts, and publish-ready pieces will appear here once the sprint content plan starts." />
      ) : (
        <section className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          {PIPELINE.map((status) => {
            const items = content.filter((item) => (item.status ?? 'idea') === status)
            return (
              <div key={status} className="pib-card p-4 min-h-[220px]">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-headline text-base font-semibold capitalize">{status.replace('_', ' ')}</h3>
                  <span className="text-xs text-[var(--color-pib-text-muted)]">{items.length}</span>
                </div>
                <div className="mt-4 space-y-3">
                  {items.length === 0 ? (
                    <p className="text-xs text-[var(--color-pib-text-muted)]">Nothing here yet.</p>
                  ) : (
                    items.map((item) => <ContentCard key={item.id} item={item} />)
                  )}
                </div>
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ContentCard({ item }: { item: any }) {
  return (
    <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-sm leading-snug">{item.title}</p>
        <span className={`text-[9px] px-2 py-1 rounded uppercase tracking-wide shrink-0 ${STATUS_PILL[item.status] ?? STATUS_PILL.idea}`}>
          {item.status ?? 'idea'}
        </span>
      </div>
      <p className="text-xs text-[var(--color-pib-text-muted)] mt-2">
        {item.type ?? 'seo content'}
        {item.publishDate && ` - ${new Date(item.publishDate).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}`}
      </p>
      {item.targetKeyword && <p className="text-xs text-[var(--color-pib-text-muted)] mt-1 truncate">Keyword: {item.targetKeyword}</p>}
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

function EmptyState({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="pib-card p-10 text-center">
      <span className="material-symbols-outlined text-4xl text-[var(--color-pib-text-muted)]">{icon}</span>
      <h3 className="font-headline text-lg font-semibold mt-3">{title}</h3>
      <p className="text-sm text-[var(--color-pib-text-muted)] mt-1.5 max-w-md mx-auto">{body}</p>
    </div>
  )
}
