import { adminDb } from '@/lib/firebase/admin'
import { Icon } from '@/components/studio'

export const dynamic = 'force-dynamic'

const STATUS_PILL: Record<string, string> = {
  idea: '',
  drafting: 'pib-pill-warn',
  review: 'pib-pill-violet',
  scheduled: 'pib-pill-blue',
  live: 'pib-pill-success',
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
    <div className="space-y-4" data-module-accent="green">
      <section className="flex items-end justify-between gap-4 flex-wrap border-b border-[var(--color-pib-line)] pb-4">
        <div>
          <p className="sc-tiny">Editorial pipeline</p>
          <h2 className="text-lg mt-1">Content</h2>
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
              <div key={status} className="st-panel p-4 min-h-[220px]">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-headline text-base capitalize">{status.replace('_', ' ')}</h3>
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
        <span className={`pib-pill !text-[9px] !px-2 !py-1 shrink-0 ${STATUS_PILL[item.status] ?? STATUS_PILL.idea}`}>
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
        <p className="sc-tiny !text-[10px]">{label}</p>
        <span aria-hidden="true" className="!h-7 !w-7"><Icon name={icon} /></span>
      </div>
      <p className="mt-3 text-xl tabular-nums tracking-tight">{value}</p>
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
